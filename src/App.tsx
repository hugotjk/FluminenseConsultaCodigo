import { useState, useEffect, useMemo, ChangeEvent } from "react";
import {
  Search,
  RefreshCw,
  Settings,
  Filter,
  Check,
  AlertTriangle,
  TrendingUp,
  Package,
  Calendar,
  Layers,
  ChevronDown,
  Info,
  Database,
  Grid,
} from "lucide-react";
import { GroupedProduct, ImageConfig } from "./types";
import { getFromDB, saveToDB } from "./utils/db";
import { saveProductsToFirestore, loadProductsFromFirestore } from "./utils/firebase";
import ProductCard from "./components/ProductCard";
import ProductDetailModal from "./components/ProductDetailModal";
import ImageConfigModal from "./components/ImageConfigModal";
import SearchableSelect from "./components/SearchableSelect";

// Helper to extract Google Drive / Google Sheets File ID from any URL or format
function extractGoogleDriveId(input: string): string {
  if (!input) return "";
  const trimmed = input.trim();
  
  // Try matching standard Google Sheets format: /spreadsheets/d/{ID}/...
  const sheetsRegex = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;
  const sheetsMatch = trimmed.match(sheetsRegex);
  if (sheetsMatch && sheetsMatch[1]) {
    return sheetsMatch[1];
  }
  
  // Try matching standard Google Drive file format: /file/d/{ID}/...
  const fileRegex = /\/file\/d\/([a-zA-Z0-9-_]+)/;
  const fileMatch = trimmed.match(fileRegex);
  if (fileMatch && fileMatch[1]) {
    return fileMatch[1];
  }

  // Try matching query parameter id: ?id={ID}
  const idParamRegex = /[?&]id=([a-zA-Z0-9-_]+)/;
  const idParamMatch = trimmed.match(idParamRegex);
  if (idParamMatch && idParamMatch[1]) {
    return idParamMatch[1];
  }

  // Try matching folders: /folders/{ID}
  const folderRegex = /\/folders\/([a-zA-Z0-9-_]+)/;
  const folderMatch = trimmed.match(folderRegex);
  if (folderMatch && folderMatch[1]) {
    return folderMatch[1];
  }

  // If it doesn't look like a URL (no slashes, or just a code), return it directly
  if (!trimmed.includes("/") && !trimmed.includes(".")) {
    return trimmed;
  }
  
  // Last resort fallback for raw base64url typical keys (28-60 chars)
  const fallbackRegex = /\b([a-zA-Z0-9-_]{28,60})\b/;
  const fallbackMatch = trimmed.match(fallbackRegex);
  if (fallbackMatch && fallbackMatch[1]) {
    return fallbackMatch[1];
  }

  return trimmed;
}

export default function App() {
  // Products and cache state
  const [products, setProducts] = useState<GroupedProduct[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number>(0);

  // App UI states
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [serverSyncing, setServerSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Filters state
  const [search, setSearch] = useState("");
  const [selectedFornecedor, setSelectedFornecedor] = useState("");
  const [selectedModelo, setSelectedModelo] = useState("");
  const [selectedGrupo, setSelectedGrupo] = useState("");
  const [selectedLinha, setSelectedLinha] = useState("");
  const [currentTab, setCurrentTab] = useState<"geral" | "maracana">("geral");

  // Modals state
  const [activeProduct, setActiveProduct] = useState<GroupedProduct | null>(null);
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  // Image configuration
  const [imageConfig, setImageConfig] = useState<ImageConfig>({
    baseUrl: "",
    matchField: "referencia",
    extension: "jpg",
  });

  // Online / Offline Status State
  const [isOnline, setIsOnline] = useState(typeof window !== "undefined" ? navigator.onLine : true);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // 1. Initial Data Fetch
  const fetchProducts = async (autoSyncIfEmpty = true) => {
    setLoading(true);
    try {
      // Clean up legacy localStorage products cache if it exists to free up quota
      if (localStorage.getItem("maraca_flu_products")) {
        try {
          localStorage.removeItem("maraca_flu_products");
        } catch (e) {
          console.warn(e);
        }
      }

      // Try IndexedDB cache first for instant/offline loading of large datasets (prevents QuotaExceededError)
      const cachedProducts = await getFromDB<GroupedProduct[]>("maraca_flu_products");
      const cachedLastUpdated = localStorage.getItem("maraca_flu_last_updated");
      const cachedFileName = localStorage.getItem("maraca_flu_file_name");
      const cachedTotalCount = localStorage.getItem("maraca_flu_total_count");

      if (cachedProducts && cachedProducts.length > 0) {
        setProducts(cachedProducts);
        setLastUpdated(cachedLastUpdated);
        setFileName(cachedFileName);
        setTotalCount(cachedTotalCount ? parseInt(cachedTotalCount, 10) : cachedProducts.length);
        setLoading(false);
        return;
      }

      // Fallback to fetch from backend if cache is empty
      let productsList: GroupedProduct[] = [];
      let lastUpdatedVal: string | null = null;
      let fileNameVal: string | null = null;
      let totalCountVal = 0;
      let loadedSuccessfully = false;

      try {
        console.log("App: Tentando carregar do backend (/api/products)...");
        const res = await fetch("/api/products");
        if (res.ok) {
          const contentType = res.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const data = await res.json();
            productsList = data.products || [];
            lastUpdatedVal = data.lastUpdated || null;
            fileNameVal = data.fileName || null;
            totalCountVal = data.totalCount || 0;
            if (productsList.length > 0) {
              loadedSuccessfully = true;
              console.log("App: Carregado com sucesso do backend!");
            }
          } else {
            console.warn("App: /api/products não retornou JSON.");
          }
        }
      } catch (backendErr) {
        console.warn("App: Falha ao carregar do backend, tentando carregar diretamente do Firestore...", backendErr);
      }

      // Se falhou no backend ou retornou vazio, carregar diretamente do Firestore no navegador (bypassa limite da Vercel)
      if (!loadedSuccessfully) {
        try {
          console.log("App: Tentando carregar diretamente do Firestore...");
          const firestoreData = await loadProductsFromFirestore();
          if (firestoreData && firestoreData.products && firestoreData.products.length > 0) {
            productsList = firestoreData.products;
            lastUpdatedVal = firestoreData.lastUpdated;
            fileNameVal = firestoreData.fileName;
            totalCountVal = firestoreData.totalCount;
            loadedSuccessfully = true;
            console.log("App: Carregado com sucesso diretamente do Firestore!");
          }
        } catch (firestoreErr) {
          console.error("App: Falha ao carregar do Firestore também:", firestoreErr);
        }
      }

      if (loadedSuccessfully) {
        setProducts(productsList);
        setLastUpdated(lastUpdatedVal);
        setFileName(fileNameVal);
        setTotalCount(totalCountVal);

        // Store in IndexedDB for future offline access
        if (productsList.length > 0) {
          await saveToDB("maraca_flu_products", productsList);
          if (lastUpdatedVal) localStorage.setItem("maraca_flu_last_updated", lastUpdatedVal);
          if (fileNameVal) localStorage.setItem("maraca_flu_file_name", fileNameVal);
          localStorage.setItem("maraca_flu_total_count", String(totalCountVal || productsList.length));
        }
      }

      // Auto-sync on load if the cache is completely empty and both sources failed
      if (autoSyncIfEmpty && productsList.length === 0) {
        console.log("Banco de dados vazio. Iniciando sincronização automática...");
        triggerSync(false);
      }
    } catch (err) {
      console.error("Erro ao carregar produtos:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchImageConfig = async () => {
    try {
      const cachedConfig = localStorage.getItem("maraca_flu_image_config");
      if (cachedConfig) {
        setImageConfig(JSON.parse(cachedConfig));
      }

      const res = await fetch("/api/image-config");
      if (res.ok) {
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const config = await res.json();
          setImageConfig(config);
          localStorage.setItem("maraca_flu_image_config", JSON.stringify(config));
        } else {
          console.warn("App: /api/image-config não retornou JSON.");
        }
      }
    } catch (err) {
      console.error("Erro ao carregar configuração de imagem:", err);
    }
  };

  useEffect(() => {
    // Load products from cache first, then automatically check and trigger sync
    fetchProducts(false).then(() => {
      // Check if data is empty or stale (> 4 hours) to trigger automatic silent sync
      const cachedLastUpdated = localStorage.getItem("maraca_flu_last_updated");
      let isCacheStale = true;
      if (cachedLastUpdated) {
        const diffMs = new Date().getTime() - new Date(cachedLastUpdated).getTime();
        const diffHours = diffMs / (1000 * 60 * 60);
        isCacheStale = diffHours >= 4;
      }
      
      // If there is no data or it is more than 4 hours old, sync silently
      if (isCacheStale) {
        console.log("Cache is stale or empty. Triggering automatic silent sync on load...");
        triggerSync(false);
      }
    });
    fetchImageConfig();

    // Setup an automatic interval of 4 hours to sync silently while the app is open
    const FOUR_HOURS = 4 * 60 * 60 * 1000;
    const intervalId = setInterval(() => {
      console.log("4 hours elapsed since last check. Triggering automatic silent sync...");
      triggerSync(false);
    }, FOUR_HOURS);

    return () => clearInterval(intervalId);
  }, []);

  // 2. Database Spreadsheet Processor
  const processExcelBuffer = async (arrayBuffer: ArrayBuffer, resolvedFileName: string, isManual: boolean): Promise<boolean> => {
    const startTime = Date.now();
    console.log(`%c[SYNC:START] processExcelBuffer iniciado às ${new Date().toLocaleTimeString()} para o arquivo: ${resolvedFileName}`, "color: #10b981; font-weight: bold;");
    console.log(`[SYNC:INFO] Tamanho do buffer recebido: ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(3)} MB (${arrayBuffer.byteLength} bytes)`);

    try {
      if (isManual) {
        setSyncMessage("Lendo planilha no navegador...");
      }
      
      // Dynamically import XLSX to avoid bloating the initial build bundle
      console.log("[SYNC:XLSX_LOAD] Carregando dinamicamente a biblioteca 'xlsx'...");
      let XLSX;
      try {
        XLSX = await import("xlsx");
        console.log("[SYNC:XLSX_LOAD] Biblioteca 'xlsx' importada com sucesso.");
      } catch (importErr: any) {
        console.error("[SYNC:XLSX_LOAD_ERROR] Falha ao importar a biblioteca 'xlsx':", importErr);
        throw new Error(`Erro do Navegador: Não foi possível carregar a biblioteca de processamento de planilhas (XLSX). Isso pode ser causado por oscilações na rede. Detalhes: ${importErr.message || importErr}`);
      }
      
      // Parse with optimized settings in client
      console.log("[SYNC:XLSX_READ] Iniciando parsing dos metadados da pasta de trabalho...");
      let metaWorkbook;
      try {
        metaWorkbook = XLSX.read(arrayBuffer, { type: "array", bookSheets: true });
      } catch (readMetaErr: any) {
        console.error("[SYNC:XLSX_READ_META_ERROR] Falha ao ler metadados do buffer:", readMetaErr);
        throw new Error(`Erro de Leitura da Planilha: O arquivo baixado não pôde ser analisado como uma pasta de trabalho válida do Excel. Isso indica que o arquivo pode estar corrompido ou o link não retornou um arquivo do Excel. Detalhes: ${readMetaErr.message || readMetaErr}`);
      }

      if (!metaWorkbook || !metaWorkbook.SheetNames || metaWorkbook.SheetNames.length === 0) {
        throw new Error("Erro de Estrutura da Planilha: A pasta de trabalho do Excel não possui nenhuma planilha/aba.");
      }
      
      const sheetName = metaWorkbook.SheetNames[0];
      console.log(`[SYNC:XLSX_READ] Planilha selecionada: "${sheetName}". Total de abas: ${metaWorkbook.SheetNames.length} (${metaWorkbook.SheetNames.join(", ")}).`);

      console.log(`[SYNC:XLSX_READ] Lendo dados da aba "${sheetName}"...`);
      let workbook;
      try {
        workbook = XLSX.read(arrayBuffer, {
          type: "array",
          sheets: [sheetName],
          cellFormula: false,
          cellHTML: false,
          cellNF: false,
          cellStyles: false,
          cellText: false,
        });
      } catch (readErr: any) {
        console.error(`[SYNC:XLSX_READ_DATA_ERROR] Falha ao ler os dados da aba "${sheetName}":`, readErr);
        throw new Error(`Erro de Leitura da Planilha: Falha ao ler os dados da aba "${sheetName}". Detalhes: ${readErr.message || readErr}`);
      }
      
      const worksheet = workbook.Sheets[sheetName];
      console.log("[SYNC:XLSX_READ] Convertendo planilha em JSON...");
      const rawRows = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        raw: true,
      }) as any[];
      
      console.log(`[SYNC:XLSX_READ] Total de linhas brutas encontradas na planilha: ${rawRows.length}`);
      if (rawRows.length === 0) {
        throw new Error(`Erro de Estrutura: A planilha "${sheetName}" está completamente vazia.`);
      }
      
      if (isManual) {
        setSyncMessage("Processando e organizando produtos por Referência e Cor...");
      }
      
      // Grouping logic (replicated exactly from server)
      console.log("[SYNC:PROCESSING] Procurando linha de cabeçalho nos primeiros 15 registros...");
      let headerIdx = -1;
      for (let i = 0; i < Math.min(15, rawRows.length); i++) {
        const r = rawRows[i];
        if (r && r.some(cell => /referencia|referência|descri|código|barra/i.test(String(cell)))) {
          headerIdx = i;
          console.log(`[SYNC:PROCESSING] Linha de cabeçalho detectada na linha índice ${i}:`, r);
          break;
        }
      }
      
      const colMap = {
        ord: 0,
        codigo_barra: 1,
        cor: 2,
        descricao: 3,
        ean: 4,
        fornecedor: 5,
        modelo: 6,
        linha: 7,
        grupo: 8,
        preco_varejo: 9,
        referencia: 10,
        referencia_fornecedor: 11,
        tamanho: 12,
        venda: 13,
        maracana: 14,
      };
      
      if (headerIdx !== -1) {
        const headers = rawRows[headerIdx];
        const findCol = (regex: RegExp) =>
          headers.findIndex((h) =>
            regex.test(
              String(h || "")
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
            )
          );
          
        colMap.ord = findCol(/ord/i);
        colMap.codigo_barra = findCol(/codigo.*barra|cod.*barra|barras|cod_barra/i);
        colMap.cor = findCol(/cor/i);
        colMap.descricao = findCol(/desc/i);
        colMap.ean = findCol(/ean/i);
        colMap.fornecedor = findCol(/fornecedor|forn/i);
        colMap.modelo = findCol(/modelo|mod/i);
        colMap.linha = findCol(/linha/i);
        colMap.grupo = findCol(/grupo/i);
        colMap.preco_varejo = findCol(/preco.*varejo|preco|valor|varejo/i);
        colMap.referencia = findCol(/^ref(erencia)?$/i);
        colMap.referencia_fornecedor = findCol(/ref.*forn|fornecedor.*ref|ref_fornecedor/i);
        colMap.tamanho = findCol(/tamanho|tam/i);
        colMap.venda = findCol(/^venda$/i);
        colMap.maracana = findCol(/maracana/i);

        console.log("[SYNC:PROCESSING] Mapeamento de colunas realizado com base no cabeçalho:", colMap);
      } else {
        console.warn("[SYNC:PROCESSING] Linha de cabeçalho não encontrada. Utilizando mapeamento de colunas padrão por índice fixo:", colMap);
      }

      // Validating critical columns
      if (colMap.referencia === -1) {
        console.error("[SYNC:STRUCTURE_ERROR] Coluna essencial 'referencia' não encontrada na planilha!");
        throw new Error("Erro de Estrutura: Não foi possível localizar a coluna de Referência (ex: 'referencia', 'REF') na planilha. Verifique os cabeçalhos.");
      }
      
      const startRow = headerIdx !== -1 ? headerIdx + 1 : 0;
      const groupMap = new Map<string, GroupedProduct>();
      
      console.log(`[SYNC:PROCESSING] Iniciando loop de processamento a partir da linha ${startRow}...`);
      let skippedLines = 0;
      let processedLines = 0;

      for (let i = startRow; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || row.length === 0) {
          skippedLines++;
          continue;
        }
        
        const ref = colMap.referencia !== -1 ? String(row[colMap.referencia] || "").trim() : "";
        if (!ref || ref === "undefined" || /referencia/i.test(ref)) {
          skippedLines++;
          continue;
        }
        
        processedLines++;
        const cor = colMap.cor !== -1 ? String(row[colMap.cor] || "").trim() || "ÚNICA" : "ÚNICA";
        const desc = colMap.descricao !== -1 ? String(row[colMap.descricao] || "").trim() : "";
        const ean = colMap.ean !== -1 ? String(row[colMap.ean] || "").trim() : "";
        const codBarra = colMap.codigo_barra !== -1 ? String(row[colMap.codigo_barra] || "").trim() : "";
        const fornecedor = colMap.fornecedor !== -1 ? String(row[colMap.fornecedor] || "").trim() || "OUTROS" : "OUTROS";
        const srcLinha = colMap.linha !== -1 ? String(row[colMap.linha] || "").trim() || "GERAL" : "GERAL";
        const srcGrupo = colMap.grupo !== -1 ? String(row[colMap.grupo] || "").trim() || "GERAL" : "GERAL";
        const refForn = colMap.referencia_fornecedor !== -1 ? String(row[colMap.referencia_fornecedor] || "").trim() : "";
        
        // Price parsing
        let preco = 0;
        if (colMap.preco_varejo !== -1) {
          const precoRaw = row[colMap.preco_varejo];
          if (typeof precoRaw === "number") {
            preco = precoRaw;
          } else if (precoRaw) {
            preco = parseFloat(
              String(precoRaw)
                .replace("R$", "")
                .replace(/\s/g, "")
                .replace(/\./g, "")
                .replace(",", ".")
            );
            if (isNaN(preco)) preco = 0;
          }
        }
        
        // Sales parsing
        let venda = 0;
        if (colMap.venda !== -1) {
          const vendaRaw = row[colMap.venda];
          if (typeof vendaRaw === "number") {
            venda = Math.round(vendaRaw);
          } else if (vendaRaw) {
            venda = parseInt(String(vendaRaw).replace(/[^\d-]/g, ""), 10);
            if (isNaN(venda)) venda = 0;
          }
        }
        
        // Maracana sales parsing
        let maracanaVenda = 0;
        if (colMap.maracana !== -1) {
          const maracanaRaw = row[colMap.maracana];
          if (typeof maracanaRaw === "number") {
            maracanaVenda = Math.round(maracanaRaw);
          } else if (maracanaRaw) {
            maracanaVenda = parseInt(String(maracanaRaw).replace(/[^\d-]/g, ""), 10);
            if (isNaN(maracanaVenda)) maracanaVenda = 0;
          }
        }
        
        const tamanho = colMap.tamanho !== -1 ? String(row[colMap.tamanho] || "").trim() || "U" : "U";
        
        let modelo = "";
        if (colMap.modelo !== -1) {
          modelo = String(row[colMap.modelo] || "").trim();
        }
        if (!modelo) {
          modelo = srcLinha || "PADRÃO";
        }
        
        const key = `${ref}_${cor}`.toUpperCase();
        
        let product = groupMap.get(key);
        if (!product) {
          product = {
            referencia: ref,
            cor,
            descricao: desc,
            fornecedor,
            modelo,
            linha: srcLinha,
            grupo: srcGrupo,
            preco_varejo: preco,
            referencia_fornecedor: refForn,
            total_vendas: 0,
            total_vendas_maracana: 0,
            variations: [],
          };
          groupMap.set(key, product);
        }
        
        product.total_vendas += venda;
        product.total_vendas_maracana += maracanaVenda;
        product.variations.push({
          codigo_barra: codBarra,
          ean,
          tamanho,
          venda,
          venda_maracana: maracanaVenda,
        });
        
        if (desc && desc.length > product.descricao.length) {
          product.descricao = desc;
        }
      }
      
      console.log(`[SYNC:PROCESSING] Fim do processamento. Linhas válidas: ${processedLines}, Linhas ignoradas: ${skippedLines}`);
      
      const productsList = Array.from(groupMap.values()).sort((a, b) => b.total_vendas - a.total_vendas);
      const nowStr = new Date().toISOString();
      
      console.log(`[SYNC:PROCESSING] Total de produtos agrupados (Ref + Cor): ${productsList.length}`);
      if (productsList.length === 0) {
        throw new Error("Erro de Estrutura: Nenhum produto pôde ser processado. Certifique-se de que a planilha possui linhas de dados válidas com campos de referência.");
      }

      // Update state
      setProducts(productsList);
      setLastUpdated(nowStr);
      setFileName(resolvedFileName);
      setTotalCount(productsList.length);
      
      // Save locally (IndexedDB for products, localStorage for metadata)
      console.log("[SYNC:STORAGE] Salvando catálogo de produtos no IndexedDB...");
      try {
        await saveToDB("maraca_flu_products", productsList);
        localStorage.setItem("maraca_flu_last_updated", nowStr);
        localStorage.setItem("maraca_flu_file_name", resolvedFileName);
        localStorage.setItem("maraca_flu_total_count", String(productsList.length));
        console.log("[SYNC:STORAGE] Catálogo local salvo com sucesso no IndexedDB e localStorage.");
      } catch (storageErr) {
        console.error("[SYNC:STORAGE_ERROR] Erro ao salvar dados na cache local (IndexedDB):", storageErr);
        // We do not fail the sync because of LocalStorage/IndexedDB errors if we already have it in memory, but let's log it.
      }
      
      // Also save directly to Firestore from client-side (critical for Vercel persistence across all clients!)
      console.log("[SYNC:FIRESTORE] Sincronizando catálogo com a nuvem (Firestore)...");
      try {
        if (isManual) {
          setSyncMessage("Salvando dados sincronizados no Firestore para todos os usuários...");
        }
        const driveId = extractGoogleDriveId(imageConfig.spreadsheetId || "1oTpB5GtJ6WwEnlhF2LhBcuH5lvw9c7_u");
        await saveProductsToFirestore(productsList, {
          lastUpdated: nowStr,
          totalCount: productsList.length,
          fileName: resolvedFileName,
          fileId: driveId
        });
        console.log(`[SYNC:FIRESTORE] Sincronização em nuvem bem sucedida para ${productsList.length} produtos! ID da Planilha: ${driveId}`);
      } catch (firestoreErr: any) {
        console.error("[SYNC:FIRESTORE_ERROR] Erro ao salvar dados no Firestore:", firestoreErr);
        // It's saved locally, but cloud sync failed. Let the user know if manual.
        if (isManual) {
          console.warn("A sincronização em nuvem falhou, mas os produtos foram carregados no seu navegador.");
        }
      }
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`%c[SYNC:SUCCESS] Processamento concluído em ${duration} segundos.`, "color: #10b981; font-weight: bold;");

      if (isManual) {
        setSyncMessage(`Sincronização concluída com sucesso! ${productsList.length} produtos carregados.`);
        setTimeout(() => setSyncMessage(null), 4000);
      }
      return true;
    } catch (err: any) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.error(`%c[SYNC:FAILED] Falha no processamento após ${duration}s:`, "color: #ef4444; font-weight: bold;", err);
      
      if (isManual) {
        // Clear sync message and show precise error
        setSyncError(err.message || "Erro inesperado ao processar a planilha.");
        setSyncMessage(null);
      }
      return false;
    }
  };

  // 2b. Database Cloud Synchronization Handler
  const runClientSideSync = async (isManual: boolean): Promise<boolean> => {
    const startTime = Date.now();
    const fileId = extractGoogleDriveId(imageConfig.spreadsheetId || "1oTpB5GtJ6WwEnlhF2LhBcuH5lvw9c7_u");
    console.log(`%c[SYNC:DOWNLOAD] Iniciando download da planilha pelo navegador. ID do Google Drive: ${fileId}`, "color: #3b82f6; font-weight: bold;");
    
    let arrayBuffer: ArrayBuffer | null = null;
    let resolvedFileName = "Base Maraca Flu.xlsx";
    
    // Track detailed logs/errors of each attempt to produce a super helpful final diagnostic if all fail
    const diagnosticLogs: string[] = [];

    // Check online status before we even start
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const connErr = "Dispositivo está offline. Conecte-se à internet para sincronizar com o Google Drive.";
      console.error(`[SYNC:DOWNLOAD] ${connErr}`);
      if (isManual) {
        setSyncError(connErr);
        setSyncMessage(null);
      }
      return false;
    }

    // TENTATIVA 1: Download direto do Google Drive no navegador (CORS) - Super rápido!
    const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    console.log(`[SYNC:DOWNLOAD] TENTATIVA 1: Download direto do Google Drive. URL: ${directUrl}`);
    if (isManual) {
      setSyncMessage("Tentando conexão direta com o Google Drive (super rápido)...");
    }

    try {
      const response = await fetch(directUrl);
      console.log(`[SYNC:DOWNLOAD] TENTATIVA 1 status recebido: ${response.status} (${response.statusText})`);
      
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        console.log(`[SYNC:DOWNLOAD] TENTATIVA 1 bytes baixados: ${buffer.byteLength}`);
        
        // Verify ZIP/XLSX magic bytes (0x50 0x4B)
        const uint8 = new Uint8Array(buffer.slice(0, 4));
        if (uint8.length >= 2 && uint8[0] === 0x50 && uint8[1] === 0x4B) {
          console.log("%c[SYNC:DOWNLOAD] TENTATIVA 1 SUCESSO! Assinatura de arquivo ZIP/XLSX confirmada.", "color: #10b981; font-weight: bold;");
          arrayBuffer = buffer;
        } else {
          const signature = Array.from(uint8).map(b => "0x" + b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
          const textPreview = new TextDecoder().decode(new Uint8Array(buffer.slice(0, 200))).replace(/[\n\r\t]/g, " ");
          const msg = `O link direto do Google Drive não retornou uma planilha válida (Bytes mágicos: ${signature}). Provavelmente a planilha não está compartilhada como 'Qualquer pessoa com o link' ou o ID está incorreto. Prévia do texto: "${textPreview.substring(0, 100)}..."`;
          console.warn(`[SYNC:DOWNLOAD] TENTATIVA 1 AVISO: ${msg}`);
          diagnosticLogs.push(`Tentativa 1 (Conexão Direta): Planilha privada ou ID inválido. O Google Drive retornou uma página HTML de login/erro em vez do arquivo Excel.`);
        }
      } else {
        const msg = `Falha na requisição direta com status HTTP ${response.status}: ${response.statusText}`;
        console.warn(`[SYNC:DOWNLOAD] TENTATIVA 1 AVISO: ${msg}`);
        diagnosticLogs.push(`Tentativa 1 (Conexão Direta): Servidor do Google Drive respondeu com erro HTTP ${response.status}.`);
      }
    } catch (directErr: any) {
      const isCors = directErr instanceof TypeError;
      const msg = `Tentativa de download direto falhou. ${isCors ? "Provável bloqueio de CORS pelo navegador ou erro de DNS." : ""} Detalhes: ${directErr.message || directErr}`;
      console.warn(`[SYNC:DOWNLOAD] TENTATIVA 1 FALHA: ${msg}`);
      diagnosticLogs.push(`Tentativa 1 (Conexão Direta): Falha de rede/CORS (${directErr.message || "Erro desconhecido"}).`);
    }

    // TENTATIVA 2: Se o download direto falhou, tentar obter em um arquivo único via Proxy do servidor (ignora CORS)
    if (!arrayBuffer) {
      console.log("[SYNC:DOWNLOAD] TENTATIVA 2: Tentando proxy de arquivo único do servidor...");
      if (isManual) {
        setSyncMessage("Tentando conexão intermediária via servidor...");
      }
      try {
        const response = await fetch(`/api/download-excel?force=1`);
        console.log(`[SYNC:DOWNLOAD] TENTATIVA 2 status recebido: ${response.status} (${response.statusText})`);
        
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          console.log(`[SYNC:DOWNLOAD] TENTATIVA 2 bytes baixados: ${buffer.byteLength}`);
          
          const uint8 = new Uint8Array(buffer.slice(0, 4));
          if (uint8.length >= 2 && uint8[0] === 0x50 && uint8[1] === 0x4B) {
            console.log("%c[SYNC:DOWNLOAD] TENTATIVA 2 SUCESSO! Arquivo ZIP/XLSX válido recebido via proxy único.", "color: #10b981; font-weight: bold;");
            arrayBuffer = buffer;
            const fileNameHeader = response.headers.get("X-File-Name");
            if (fileNameHeader) resolvedFileName = decodeURIComponent(fileNameHeader);
          } else {
            const signature = Array.from(uint8).map(b => "0x" + b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
            const msg = `O proxy de arquivo único retornou dados que não correspondem a um arquivo Excel (Bytes mágicos: ${signature}).`;
            console.warn(`[SYNC:DOWNLOAD] TENTATIVA 2 AVISO: ${msg}`);
            diagnosticLogs.push(`Tentativa 2 (Proxy Único): O servidor retornou uma resposta que não é uma planilha Excel (provavelmente erro de permissão ou configuração de chave de API no servidor).`);
          }
        } else {
          const msg = `O proxy único respondeu com código de erro HTTP ${response.status}`;
          console.warn(`[SYNC:DOWNLOAD] TENTATIVA 2 AVISO: ${msg}`);
          diagnosticLogs.push(`Tentativa 2 (Proxy Único): O servidor proxy respondeu com código de erro HTTP ${response.status}.`);
        }
      } catch (proxyErr: any) {
        const msg = `Erro ao contatar o proxy único do servidor: ${proxyErr.message || proxyErr}`;
        console.warn(`[SYNC:DOWNLOAD] TENTATIVA 2 FALHA: ${msg}`);
        diagnosticLogs.push(`Tentativa 2 (Proxy Único): Falha ao se conectar com o servidor local (${proxyErr.message || "Erro de conexão"}).`);
      }
    }

    // TENTATIVA 3: Se o proxy de arquivo único falhou, usar o sistema de partes/pedaços dinâmicos (Chunks) para arquivos grandes
    if (!arrayBuffer) {
      console.log("[SYNC:DOWNLOAD] TENTATIVA 3: Tentando proxy do servidor em blocos dinâmicos (Chunks)...");
      if (isManual) {
        setSyncMessage("Usando proxy em blocos dinâmicos para grandes volumes...");
      }
      try {
        const infoRes = await fetch(`/api/download-excel?info=1${isManual ? "&bypassCache=1" : ""}`);
        console.log(`[SYNC:DOWNLOAD] TENTATIVA 3 metadados status recebido: ${infoRes.status}`);
        
        if (!infoRes.ok) {
          throw new Error(`Falha ao obter informações do arquivo via proxy (Status: ${infoRes.status})`);
        }
        
        const contentType = infoRes.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          throw new Error("O servidor proxy não retornou dados JSON (possível falha de roteamento ou servidor fora do ar).");
        }
        
        const info = await infoRes.json();
        const { totalParts, chunkSize, fileName: infoFileName, totalLength } = info;
        resolvedFileName = infoFileName || resolvedFileName;
        console.log(`[SYNC:DOWNLOAD] TENTATIVA 3 metadados: Tamanho total do arquivo: ${(totalLength / 1024 / 1024).toFixed(3)} MB (${totalLength} bytes), Total de partes: ${totalParts}, Tamanho do chunk: ${(chunkSize / 1024).toFixed(1)} KB`);

        if (isManual) {
          setSyncMessage(`Baixando planilha (${(totalLength / 1024 / 1024).toFixed(2)} MB) em ${totalParts} partes...`);
        }
        
        // Download all parts in parallel chunks
        console.log(`[SYNC:DOWNLOAD] Iniciando download das ${totalParts} partes em paralelo...`);
        const partPromises = [];
        for (let p = 1; p <= totalParts; p++) {
          partPromises.push(
            fetch(`/api/download-excel?part=${p}&chunkSize=${chunkSize}`).then(async (res) => {
              if (!res.ok) {
                throw new Error(`Falha no download da parte ${p}: ${res.statusText}`);
              }
              console.log(`[SYNC:DOWNLOAD] Parte ${p}/${totalParts} baixada com sucesso.`);
              return res.arrayBuffer();
            })
          );
        }

        const partBuffers = await Promise.all(partPromises);
        console.log("[SYNC:DOWNLOAD] Todas as partes foram baixadas! Iniciando reconstrução do arquivo em memória...");
        
        // Reconstruct the full file buffer
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (let i = 0; i < partBuffers.length; i++) {
          combined.set(new Uint8Array(partBuffers[i]), offset);
          offset += partBuffers[i].byteLength;
        }
        
        // Final verification on reconstructed buffer
        const uint8 = combined.subarray(0, 4);
        if (uint8.length >= 2 && uint8[0] === 0x50 && uint8[1] === 0x4B) {
          console.log("%c[SYNC:DOWNLOAD] TENTATIVA 3 SUCESSO! Arquivo ZIP/XLSX reconstruído com sucesso.", "color: #10b981; font-weight: bold;");
          arrayBuffer = combined.buffer;
        } else {
          throw new Error("Arquivo reconstruído é inválido (assinatura do Excel ausente após junção dos blocos).");
        }
      } catch (chunkErr: any) {
        const msg = `Erro no proxy em blocos: ${chunkErr.message || chunkErr}`;
        console.warn(`[SYNC:DOWNLOAD] TENTATIVA 3 FALHA: ${msg}`);
        diagnosticLogs.push(`Tentativa 3 (Proxy em Blocos): ${chunkErr.message || "Falha de processamento em partes."}`);
      }
    }

    // Se após as 3 tentativas não temos o buffer da planilha, geramos um erro rico e diagnóstico detalhado
    if (!arrayBuffer) {
      console.error("[SYNC:DOWNLOAD_ERROR] Todas as tentativas de baixar o arquivo falharam.");
      console.table(diagnosticLogs);

      // Vamos diferenciar os problemas para orientar o usuário perfeitamente:
      let userFriendlyMessage = "Falha ao obter o arquivo de planilha. Detalhes do diagnóstico:\n\n";
      
      const hasPrivateError = diagnosticLogs.some(log => log.includes("privada") || log.includes("HTML"));
      const hasConnectionError = diagnosticLogs.some(log => log.includes("Falha de rede") || log.includes("conexão") || log.includes("CORS"));

      if (hasPrivateError) {
        userFriendlyMessage = "🚫 PROBLEMA DE PERMISSÃO / COMPARTILHAMENTO:\nO Google Drive bloqueou o acesso direto à planilha. Isso geralmente acontece porque ela não está compartilhada como 'Qualquer pessoa com o link pode ler'.\n\nComo resolver:\n1. Abra a planilha no seu Google Drive.\n2. Clique em 'Compartilhar' (canto superior direito).\n3. Mude de 'Restrito' para 'Qualquer pessoa com o link'.\n4. Garanta que a função está como 'Leitor'.\n5. Clique em Concluído e tente sincronizar novamente no App.";
      } else if (hasConnectionError) {
        userFriendlyMessage = "🌐 PROBLEMA DE CONEXÃO / REDE:\nNão foi possível conectar-se aos servidores do Google Drive ou ao nosso servidor proxy. Verifique sua conexão com a internet ou se o servidor está ativo.\nSe o problema persistir, use a opção 'Importar Planilha (.xlsx)' na aba de configurações para carregar o arquivo localmente.";
      } else {
        userFriendlyMessage = `❌ ERRO DE SINCRONIZAÇÃO:\nNão foi possível obter a planilha do Google Drive pelas rotas disponíveis. Verifique o ID configurado ou o compartilhamento da planilha.\n\nLogs técnicos:\n- ${diagnosticLogs.join('\n- ')}`;
      }

      throw new Error(userFriendlyMessage);
    }
    
    // Sucesso no download, prossegue para o processamento do XLSX
    const downloadDuration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[SYNC:DOWNLOAD_SUCCESS] Planilha baixada com sucesso em ${downloadDuration} segundos. Passando para leitura do arquivo XLSX...`);
    
    return await processExcelBuffer(arrayBuffer, resolvedFileName, isManual);
  };



  const triggerSync = async (isManual = true) => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      if (isManual) {
        setSyncError("Sem conexão com a internet. Conecte-se para sincronizar.");
        setTimeout(() => setSyncError(null), 4000);
      }
      return;
    }

    // Detect if we are running in a serverless environment (like Vercel)
    const isVercelHost = typeof window !== "undefined" && (
      window.location.hostname.includes("vercel.app") || 
      window.location.hostname.includes("fluminense-consulta") ||
      window.location.hostname.includes("carteira-adidas")
    );

    setSyncing(true);

    if (isVercelHost) {
      // Direct client-side sync on Vercel to bypass Vercel's execution limits
      setServerSyncing(false);
      try {
        await runClientSideSync(isManual);
      } catch (err: any) {
        console.error("Direct Vercel client-side sync failed:", err);
        if (isManual) {
          setSyncError(err.message || "Falha na sincronização pelo navegador.");
        }
      } finally {
        setSyncing(false);
      }
      return;
    }

    setServerSyncing(true);
    if (isManual) {
      setSyncError(null);
      setSyncMessage("Sincronizando planilha com o servidor (baixa e processa)...");
    }

    try {
      const res = await fetch("/api/sync", {
        method: "POST"
      });

      if (!res.ok) {
        throw new Error(`Servidor retornou status ${res.status}`);
      }

      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("O servidor retornou uma resposta inválida ou página HTML (esperava JSON). Isso pode ocorrer se o servidor estiver carregando ou em manutenção.");
      }

      const data = await res.json();
      if (data.success) {
        const productsList = data.products || [];
        setProducts(productsList);
        setLastUpdated(data.lastUpdated || null);
        setFileName(data.fileName || null);
        setTotalCount(data.totalCount || 0);

        // Update client storage (IndexedDB for products, localStorage for metadata)
        await saveToDB("maraca_flu_products", productsList);
        if (data.lastUpdated) localStorage.setItem("maraca_flu_last_updated", data.lastUpdated);
        if (data.fileName) localStorage.setItem("maraca_flu_file_name", data.fileName);
        localStorage.setItem("maraca_flu_total_count", String(data.totalCount || productsList.length));

        if (isManual) {
          setSyncMessage("Sincronização concluída com sucesso!");
          setTimeout(() => setSyncMessage(null), 3000);
        }
      } else {
        throw new Error(data.error || "Falha ao sincronizar");
      }
    } catch (err: any) {
      console.error("Erro ao sincronizar pelo servidor, tentando processamento local...", err);
      // Fallback to client-side sync in case the server is offline or fails
      await runClientSideSync(isManual);
    } finally {
      setServerSyncing(false);
      setSyncing(false);
    }
  };

  // 3. Save Image Config
  const handleSaveImageConfig = async (newConfig: ImageConfig) => {
    try {
      // Save locally first for instant updates
      localStorage.setItem("maraca_flu_image_config", JSON.stringify(newConfig));
      setImageConfig(newConfig);

      // Best effort update on backend
      await fetch("/api/image-config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(newConfig),
      });
    } catch (err) {
      console.error("Erro ao salvar imagens no backend (salvo localmente):", err);
    }
  };

  // 5. Dynamic Cascading Filter calculations
  // Suppliers matching other filters
  const fornecedorOptions = useMemo(() => {
    const matches = products.filter((p) => {
      if (selectedModelo && p.modelo !== selectedModelo) return false;
      if (selectedGrupo && p.grupo !== selectedGrupo) return false;
      if (selectedLinha && p.linha !== selectedLinha) return false;
      return true;
    });
    const stats = new Map<string, { count: number; sales: number }>();
    matches.forEach((p) => {
      const current = stats.get(p.fornecedor) || { count: 0, sales: 0 };
      const v = currentTab === "maracana" ? (p.total_vendas_maracana || 0) : p.total_vendas;
      stats.set(p.fornecedor, {
        count: current.count + 1,
        sales: current.sales + v,
      });
    });
    return Array.from(stats.entries()).sort((a, b) => b[1].sales - a[1].sales || b[1].count - a[1].count || a[0].localeCompare(b[0]));
  }, [products, selectedModelo, selectedGrupo, selectedLinha, currentTab]);

  const totalFornecedorSales = useMemo(() => {
    return fornecedorOptions.reduce((acc, curr) => acc + curr[1].sales, 0);
  }, [fornecedorOptions]);

  // Models matching other filters
  const modeloOptions = useMemo(() => {
    const matches = products.filter((p) => {
      if (selectedFornecedor && p.fornecedor !== selectedFornecedor) return false;
      if (selectedGrupo && p.grupo !== selectedGrupo) return false;
      if (selectedLinha && p.linha !== selectedLinha) return false;
      return true;
    });
    const stats = new Map<string, { count: number; sales: number }>();
    matches.forEach((p) => {
      const current = stats.get(p.modelo) || { count: 0, sales: 0 };
      const v = currentTab === "maracana" ? (p.total_vendas_maracana || 0) : p.total_vendas;
      stats.set(p.modelo, {
        count: current.count + 1,
        sales: current.sales + v,
      });
    });
    return Array.from(stats.entries()).sort((a, b) => b[1].sales - a[1].sales || b[1].count - a[1].count || a[0].localeCompare(b[0]));
  }, [products, selectedFornecedor, selectedGrupo, selectedLinha, currentTab]);

  const totalModeloSales = useMemo(() => {
    return modeloOptions.reduce((acc, curr) => acc + curr[1].sales, 0);
  }, [modeloOptions]);

  // Groups matching other filters
  const grupoOptions = useMemo(() => {
    const matches = products.filter((p) => {
      if (selectedFornecedor && p.fornecedor !== selectedFornecedor) return false;
      if (selectedModelo && p.modelo !== selectedModelo) return false;
      if (selectedLinha && p.linha !== selectedLinha) return false;
      return true;
    });
    const stats = new Map<string, { count: number; sales: number }>();
    matches.forEach((p) => {
      const current = stats.get(p.grupo) || { count: 0, sales: 0 };
      const v = currentTab === "maracana" ? (p.total_vendas_maracana || 0) : p.total_vendas;
      stats.set(p.grupo, {
        count: current.count + 1,
        sales: current.sales + v,
      });
    });
    return Array.from(stats.entries()).sort((a, b) => b[1].sales - a[1].sales || b[1].count - a[1].count || a[0].localeCompare(b[0]));
  }, [products, selectedFornecedor, selectedModelo, selectedLinha, currentTab]);

  const totalGrupoSales = useMemo(() => {
    return grupoOptions.reduce((acc, curr) => acc + curr[1].sales, 0);
  }, [grupoOptions]);

  // Lines matching other filters
  const linhaOptions = useMemo(() => {
    const matches = products.filter((p) => {
      if (selectedFornecedor && p.fornecedor !== selectedFornecedor) return false;
      if (selectedModelo && p.modelo !== selectedModelo) return false;
      if (selectedGrupo && p.grupo !== selectedGrupo) return false;
      return true;
    });
    const stats = new Map<string, { count: number; sales: number }>();
    matches.forEach((p) => {
      const current = stats.get(p.linha) || { count: 0, sales: 0 };
      const v = currentTab === "maracana" ? (p.total_vendas_maracana || 0) : p.total_vendas;
      stats.set(p.linha, {
        count: current.count + 1,
        sales: current.sales + v,
      });
    });
    return Array.from(stats.entries()).sort((a, b) => b[1].sales - a[1].sales || b[1].count - a[1].count || a[0].localeCompare(b[0]));
  }, [products, selectedFornecedor, selectedModelo, selectedGrupo, currentTab]);

  const totalLinhaSales = useMemo(() => {
    return linhaOptions.reduce((acc, curr) => acc + curr[1].sales, 0);
  }, [linhaOptions]);

  // 6. Filter and Search matching
  const filteredProducts = useMemo(() => {
    const list = products.filter((p) => {
      if (selectedFornecedor && p.fornecedor !== selectedFornecedor) return false;
      if (selectedModelo && p.modelo !== selectedModelo) return false;
      if (selectedGrupo && p.grupo !== selectedGrupo) return false;
      if (selectedLinha && p.linha !== selectedLinha) return false;

      if (search.trim()) {
        const terms = search.toLowerCase().trim().split(/\s+/);
        // Build list of searchable strings for the product
        const searchStrings = [
          p.referencia.toLowerCase(),
          p.referencia_fornecedor.toLowerCase(),
          p.descricao.toLowerCase(),
          ...p.variations.map((v) => v.codigo_barra.toLowerCase()),
          ...p.variations.map((v) => v.ean.toLowerCase()),
        ];

        // Every term must be present in at least one searchable string
        return terms.every((term) =>
          searchStrings.some((str) => str.includes(term))
        );
      }

      return true;
    });

    // Dynamic sorting based on currentTab
    if (currentTab === "maracana") {
      return [...list].sort((a, b) => (b.total_vendas_maracana || 0) - (a.total_vendas_maracana || 0));
    } else {
      return [...list].sort((a, b) => b.total_vendas - a.total_vendas);
    }
  }, [products, selectedFornecedor, selectedModelo, selectedGrupo, selectedLinha, search, currentTab]);

  // Total sales of current selection
  const totalSalesSelected = useMemo(() => {
    return filteredProducts.reduce((sum, p) => sum + (currentTab === "maracana" ? (p.total_vendas_maracana || 0) : p.total_vendas), 0);
  }, [filteredProducts, currentTab]);

  // Determine if database is stale (> 4 hours)
  const isStale = useMemo(() => {
    if (!lastUpdated) return true;
    const diffMs = new Date().getTime() - new Date(lastUpdated).getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    return diffHours >= 4;
  }, [lastUpdated]);

  const lastUpdatedFormatted = useMemo(() => {
    if (!lastUpdated) return "Nunca";
    return new Date(lastUpdated).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [lastUpdated]);

  const resetFilters = () => {
    setSelectedFornecedor("");
    setSelectedModelo("");
    setSelectedGrupo("");
    setSelectedLinha("");
    setSearch("");
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800 font-sans selection:bg-flu-grena selection:text-white">
      {/* HEADER SECTION (Fluminense Tricolor) */}
      <header className="bg-white shadow-md relative z-30 shrink-0">
        {/* Tricolor top border ribbon */}
        <div className="h-2.5 w-full flex">
          <div className="flex-1 bg-flu-grena" />
          <div className="flex-1 bg-white" />
          <div className="flex-1 bg-flu-verde" />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          {/* Brand Logo & Name */}
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-flu-grena rounded-2xl flex items-center justify-center text-white shadow-md border-2 border-flu-verde overflow-hidden shrink-0 relative group">
              <span className="font-display font-black text-lg tracking-tighter">FFC</span>
              <div className="absolute inset-x-0 bottom-0 h-1 bg-flu-verde" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display font-black text-xl text-flu-grena tracking-tight uppercase leading-none">
                  Maraca Flu
                </h1>
                <span className="bg-flu-grena/10 text-flu-grena border border-flu-grena/20 text-[9px] font-extrabold px-1.5 py-0.5 rounded-md uppercase tracking-wider">
                  v1.2.0
                </span>
              </div>
              <p className="text-xs text-slate-400 font-bold tracking-wider uppercase mt-1">
                Consulta de Produtos
              </p>
            </div>
          </div>

          {/* Settings & Manual Sync */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Settings/Config Button */}
            <button
              onClick={() => setIsConfigOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all shadow-sm border border-slate-200 cursor-pointer"
            >
              <Settings size={14} />
              Configurações
            </button>

            {/* Direct Sync Button */}
            <button
              onClick={() => triggerSync()}
              disabled={syncing || !isOnline}
              className={`flex items-center gap-1.5 px-4 py-2 text-white text-xs font-bold rounded-xl transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.03] cursor-pointer ${
                !isOnline ? "bg-slate-400 hover:bg-slate-400" : "bg-flu-verde hover:bg-emerald-950"
              }`}
            >
              <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
              {syncing ? "Sincronizando..." : !isOnline ? "Offline" : "Sincronizar Planilha"}
            </button>
          </div>
        </div>
      </header>

      {/* METRICS & ALERTS BAR */}
      <section className="bg-slate-100 border-b border-slate-200 py-3 shrink-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 text-xs text-slate-500">
          <div className="flex flex-wrap items-center gap-y-1 gap-x-4">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold text-[10px] ${isOnline ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-amber-50 text-amber-700 border border-amber-200 animate-pulse"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-emerald-500" : "bg-amber-500"}`} />
              {isOnline ? "ONLINE" : "OFFLINE"}
            </span>
            <span className="flex items-center gap-1 font-bold">
              <Database size={13} className="text-slate-400" />
              Base: <span className="text-slate-700 font-mono">{fileName || "Nenhuma carregada"}</span>
            </span>
            <span className="flex items-center gap-1 font-bold">
              <Calendar size={13} className="text-slate-400" />
              Sincronizado: <span className="text-slate-700">{lastUpdatedFormatted}</span>
            </span>
            {isStale && products.length > 0 && (
              <span className="bg-amber-50 text-amber-700 border border-amber-200 rounded-lg px-2 py-0.5 font-bold flex items-center gap-1">
                <AlertTriangle size={11} />
                Desatualizado (Sincronização recomendada a cada 4 horas)
              </span>
            )}
          </div>

          <div className="flex items-center gap-4 border-t md:border-t-0 pt-2 md:pt-0 border-slate-200">
            <span className="font-bold">
              Modelos: <span className="text-slate-900 font-black">{totalCount}</span>
            </span>
          </div>
        </div>
      </section>

      {/* SYNC NOTIFICATIONS */}
      {syncMessage && (
        <div className="bg-emerald-500 text-white font-bold text-xs py-2 px-4 shadow-md text-center transition-all animate-fade-in flex items-center justify-center gap-1.5 z-40">
          {syncing ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : (
            <Check size={14} />
          )}
          <span>{syncMessage}</span>
        </div>
      )}
      {syncError && (
        <div className="bg-rose-500 text-white font-bold text-xs py-2.5 px-4 shadow-md text-center transition-all animate-fade-in flex items-center justify-center gap-1.5 z-40">
          <AlertTriangle size={14} />
          <span>{syncError}</span>
          <button
            onClick={() => setSyncError(null)}
            className="ml-2 font-black underline bg-rose-600 hover:bg-rose-700 px-2 py-1 rounded"
          >
            Fechar
          </button>
        </div>
      )}

      {/* MAIN LAYOUT */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-6 overflow-hidden">
        {/* TABS SECTION */}
        <div className="flex bg-slate-100 p-1 rounded-2xl self-start border border-slate-200/50">
          <button
            onClick={() => setCurrentTab("geral")}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-display font-black text-xs uppercase tracking-wider transition-all duration-200 cursor-pointer ${
              currentTab === "geral"
                ? "bg-white text-flu-grena shadow-sm"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            Geral
          </button>
          <button
            onClick={() => setCurrentTab("maracana")}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-display font-black text-xs uppercase tracking-wider transition-all duration-200 cursor-pointer ${
              currentTab === "maracana"
                ? "bg-white text-flu-grena shadow-sm"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            Maracanã
          </button>
        </div>

        {/* SEARCH AND FILTERS CONTAINER */}
        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-4 flex flex-col gap-3.5 shrink-0">
          {/* Smart Search Bar */}
          <div className="relative">
            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-slate-400">
              <Search size={18} />
            </div>
            <input
              type="text"
              placeholder="Digite a referência, referência fornecedor, EAN ou parte da descrição..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-11 pr-24 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:outline-none focus:border-flu-grena focus:ring-1 focus:ring-flu-grena transition-all text-slate-800 placeholder-slate-400 font-medium"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-slate-600 uppercase tracking-wider"
              >
                Limpar
              </button>
            )}
          </div>

          {/* Dynamic Cascading Filters */}
          <div className="flex flex-nowrap overflow-x-auto gap-2.5 pb-2 pt-1 scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
            <SearchableSelect
              label="Fornecedor"
              icon={<Layers size={11} />}
              value={selectedFornecedor}
              onChange={setSelectedFornecedor}
              options={fornecedorOptions}
              allLabelSales={totalFornecedorSales}
            />

            <SearchableSelect
              label="Modelo"
              icon={<Layers size={11} />}
              value={selectedModelo}
              onChange={setSelectedModelo}
              options={modeloOptions}
              allLabelSales={totalModeloSales}
            />

            <SearchableSelect
              label="Grupo"
              icon={<Layers size={11} />}
              value={selectedGrupo}
              onChange={setSelectedGrupo}
              options={grupoOptions}
              allLabelSales={totalGrupoSales}
              align="right"
            />

            <SearchableSelect
              label="Linha"
              icon={<Layers size={11} />}
              value={selectedLinha}
              onChange={setSelectedLinha}
              options={linhaOptions}
              allLabelSales={totalLinhaSales}
              align="right"
            />
          </div>

          {/* Reset Filters button */}
          {(search || selectedFornecedor || selectedModelo || selectedGrupo || selectedLinha) && (
            <div className="flex justify-end pt-1">
              <button
                onClick={resetFilters}
                className="text-xs font-bold text-flu-grena hover:text-red-950 uppercase tracking-wider flex items-center gap-1 hover:underline"
              >
                <Filter size={12} />
                Limpar Todos os Filtros
              </button>
            </div>
          )}
        </div>

        {/* PRODUCTS CATALOG SECTION */}
        <div className="flex-1 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <RefreshCw className="animate-spin text-flu-grena" size={40} />
              <div className="text-slate-400 text-sm font-bold uppercase tracking-wider">
                Carregando catálogo de produtos...
              </div>
            </div>
          ) : filteredProducts.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-5 animate-slide-up">
              {filteredProducts.map((product) => (
                <ProductCard
                  key={`${product.referencia}_${product.cor}`}
                  product={product}
                  imageConfig={imageConfig}
                  onClick={() => setActiveProduct(product)}
                  currentTab={currentTab}
                />
              ))}
            </div>
          ) : (
            <div className="bg-white border border-slate-100 rounded-[2rem] p-12 text-center shadow-sm flex flex-col items-center justify-center max-w-md mx-auto mt-10 space-y-4">
              <div className="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center">
                <Package size={28} />
              </div>
              <div>
                <h3 className="font-display font-black text-slate-700 text-base uppercase tracking-tight">
                  Nenhum Produto Encontrado
                </h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Não encontramos produtos correspondentes aos filtros selecionados. Tente ajustar sua busca ou limpar os filtros.
                </p>
              </div>
              <button
                onClick={resetFilters}
                className="px-5 py-2.5 bg-flu-grena hover:bg-red-950 text-white font-bold text-xs rounded-xl transition-all uppercase tracking-wider shadow-sm hover:scale-105"
              >
                Limpar Filtros
              </button>
            </div>
          )}
        </div>
      </main>

      {/* FOOTER */}
      <footer className="bg-white border-t border-slate-200 py-3 text-center text-[10px] text-slate-400 font-bold uppercase tracking-wider shrink-0 z-20">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row justify-between items-center gap-2">
          <span>© 2026 Maraca Flu v1.2.0 — Todos os direitos reservados.</span>
          <span className="flex items-center gap-1 text-[9px] text-slate-300">
            <Info size={11} /> Cores oficiais do Fluminense F.C.
          </span>
        </div>
      </footer>

      {/* MODALS */}
      {activeProduct && (
        <ProductDetailModal
          product={activeProduct}
          imageConfig={imageConfig}
          onClose={() => setActiveProduct(null)}
        />
      )}

      {isConfigOpen && (
        <ImageConfigModal
          currentConfig={imageConfig}
          onSave={handleSaveImageConfig}
          onClose={() => setIsConfigOpen(false)}
          onImportLocalFile={processExcelBuffer}
          isSyncing={syncing}
          onTriggerCloudSync={() => triggerSync(true)}
        />
      )}
    </div>
  );
}
