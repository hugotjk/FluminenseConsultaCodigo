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
import ProductCard from "./components/ProductCard";
import ProductDetailModal from "./components/ProductDetailModal";
import ImageConfigModal from "./components/ImageConfigModal";
import SearchableSelect from "./components/SearchableSelect";

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
      const res = await fetch("/api/products");
      if (res.ok) {
        const data = await res.json();
        const productsList = data.products || [];
        setProducts(productsList);
        setLastUpdated(data.lastUpdated || null);
        setFileName(data.fileName || null);
        setTotalCount(data.totalCount || 0);

        // Store in IndexedDB for future offline access
        if (productsList.length > 0) {
          await saveToDB("maraca_flu_products", productsList);
          if (data.lastUpdated) localStorage.setItem("maraca_flu_last_updated", data.lastUpdated);
          if (data.fileName) localStorage.setItem("maraca_flu_file_name", data.fileName);
          localStorage.setItem("maraca_flu_total_count", String(data.totalCount || productsList.length));
        }

        // Auto-sync on load if the cache is completely empty
        if (autoSyncIfEmpty && productsList.length === 0) {
          console.log("Database empty. Auto-triggering sync...");
          triggerSync(false);
        }
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
        const config = await res.json();
        setImageConfig(config);
        localStorage.setItem("maraca_flu_image_config", JSON.stringify(config));
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

  // 2. Database Synchronization Handler
  const runClientSideSync = async (isManual: boolean): Promise<boolean> => {
    try {
      let arrayBuffer: ArrayBuffer | null = null;
      let resolvedFileName = "Base Maraca Flu.xlsx";
      
      const fileId = "1oTpB5GtJ6WwEnlhF2LhBcuH5lvw9c7_u";
      const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

      // TENTATIVA 1: Download direto do Google Drive no navegador (CORS) - Super rápido, ignora limites da Vercel!
      if (isManual) {
        setSyncMessage("Tentando conexão direta com o Google Drive (super rápido)...");
      }
      try {
        console.log("Attempting direct Google Drive download...");
        const response = await fetch(directUrl);
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          // Verify ZIP/XLSX magic bytes (0x50 0x4B)
          const uint8 = new Uint8Array(buffer.slice(0, 4));
          if (uint8.length >= 2 && uint8[0] === 0x50 && uint8[1] === 0x4B) {
            console.log("Direct Google Drive download succeeded with valid ZIP/XLSX bytes!");
            arrayBuffer = buffer;
          } else {
            console.warn("Direct download did not return a valid XLSX file (missing ZIP magic bytes).");
          }
        } else {
          console.warn(`Direct download failed with status ${response.status}: ${response.statusText}`);
        }
      } catch (directErr) {
        console.warn("Direct download from Google Drive failed (likely CORS or network limit):", directErr);
      }

      // TENTATIVA 2: Se o download direto falhou, tentar obter em um arquivo único via Proxy do servidor
      if (!arrayBuffer) {
        if (isManual) {
          setSyncMessage("Tentando conexão intermediária via servidor...");
        }
        try {
          console.log("Attempting single-request proxy download...");
          const response = await fetch(`/api/download-excel?force=1`);
          if (response.ok) {
            const buffer = await response.arrayBuffer();
            const uint8 = new Uint8Array(buffer.slice(0, 4));
            if (uint8.length >= 2 && uint8[0] === 0x50 && uint8[1] === 0x4B) {
              console.log("Single-request proxy download succeeded with valid ZIP/XLSX bytes!");
              arrayBuffer = buffer;
              const fileNameHeader = response.headers.get("X-File-Name");
              if (fileNameHeader) resolvedFileName = decodeURIComponent(fileNameHeader);
            } else {
              console.warn("Proxy download did not return a valid XLSX file.");
            }
          } else {
            console.warn(`Proxy single download failed with status ${response.status}`);
          }
        } catch (proxyErr) {
          console.warn("Proxy single download failed:", proxyErr);
        }
      }

      // TENTATIVA 3: Se o proxy de arquivo único falhou, usar o sistema de partes/pedaços dinâmicos (Chunks)
      if (!arrayBuffer) {
        if (isManual) {
          setSyncMessage("Usando proxy em blocos dinâmicos para grandes volumes...");
        }
        const infoRes = await fetch(`/api/download-excel?info=1${isManual ? "&bypassCache=1" : ""}`);
        if (!infoRes.ok) {
          throw new Error(`Falha ao obter informações do arquivo via proxy: ${infoRes.statusText}`);
        }
        const info = await infoRes.json();
        const { totalParts, chunkSize, fileName: infoFileName, totalLength } = info;
        resolvedFileName = infoFileName || resolvedFileName;

        if (isManual) {
          setSyncMessage(`Baixando planilha (${(totalLength / 1024 / 1024).toFixed(2)} MB) em ${totalParts} partes...`);
        }
        
        // Download all parts in parallel chunks
        const partPromises = [];
        for (let p = 1; p <= totalParts; p++) {
          partPromises.push(
            fetch(`/api/download-excel?part=${p}&chunkSize=${chunkSize}`).then(async (res) => {
              if (!res.ok) {
                throw new Error(`Falha no download da parte ${p}: ${res.statusText}`);
              }
              return res.arrayBuffer();
            })
          );
        }

        const partBuffers = await Promise.all(partPromises);
        
        // Reconstruct the full file buffer
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (let i = 0; i < partBuffers.length; i++) {
          combined.set(new Uint8Array(partBuffers[i]), offset);
          offset += partBuffers[i].byteLength;
        }
        
        arrayBuffer = combined.buffer;
      }

      if (!arrayBuffer) {
        throw new Error("Não foi possível obter o arquivo de planilha das fontes disponíveis. Verifique o link de compartilhamento.");
      }
      
      if (isManual) {
        setSyncMessage("Lendo planilha de 100 mil linhas no navegador...");
      }
      
      // 2. Dynamically import XLSX to avoid bloating the initial build bundle
      const XLSX = await import("xlsx");
      
      // 3. Parse with optimized settings in client
      const metaWorkbook = XLSX.read(arrayBuffer, { type: "array", bookSheets: true });
      if (metaWorkbook.SheetNames.length === 0) {
        throw new Error("O arquivo Excel baixado está vazio.");
      }
      
      const sheetName = metaWorkbook.SheetNames[0];
      const workbook = XLSX.read(arrayBuffer, {
        type: "array",
        sheets: [sheetName],
        cellFormula: false,
        cellHTML: false,
        cellNF: false,
        cellStyles: false,
        cellText: false,
      });
      
      const worksheet = workbook.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json<any[]>(worksheet, {
        header: 1,
        raw: true,
      });
      
      if (rawRows.length === 0) {
        throw new Error("Nenhum dado encontrado na primeira planilha.");
      }
      
      if (isManual) {
        setSyncMessage("Processando e organizando produtos por Referência e Cor...");
      }
      
      // 4. Grouping logic (replicated exactly from server)
      let headerIdx = -1;
      for (let i = 0; i < Math.min(15, rawRows.length); i++) {
        const r = rawRows[i];
        if (r && r.some(cell => /referencia|referência|descri|código|barra/i.test(String(cell)))) {
          headerIdx = i;
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
          
        const ord = findCol(/ord/i);
        const cod = findCol(/codigo.*barra|cod.*barra|barras|cod_barra/i);
        const cor = findCol(/cor/i);
        const desc = findCol(/desc/i);
        const ean = findCol(/ean/i);
        const forn = findCol(/fornecedor|forn/i);
        const mod = findCol(/modelo|mod/i);
        const lin = findCol(/linha/i);
        const grup = findCol(/grupo/i);
        const prec = findCol(/preco.*varejo|preco|valor|varejo/i);
        const ref = findCol(/^ref(erencia)?$/i);
        const ref_forn = findCol(/ref.*forn|fornecedor.*ref|ref_fornecedor/i);
        const tam = findCol(/tamanho|tam/i);
        const vend = findCol(/^venda$/i);
        const mara = findCol(/maracana/i);
        
        if (ord !== -1) colMap.ord = ord;
        if (cod !== -1) colMap.codigo_barra = cod;
        if (cor !== -1) colMap.cor = cor;
        if (desc !== -1) colMap.descricao = desc;
        if (ean !== -1) colMap.ean = ean;
        if (forn !== -1) colMap.fornecedor = forn;
        if (lin !== -1) colMap.linha = lin;
        if (grup !== -1) colMap.grupo = grup;
        if (prec !== -1) colMap.preco_varejo = prec;
        if (ref !== -1) colMap.referencia = ref;
        if (ref_forn !== -1) colMap.referencia_fornecedor = ref_forn;
        if (tam !== -1) colMap.tamanho = tam;
        if (vend !== -1) colMap.venda = vend;
        if (mod !== -1) colMap.modelo = mod;
        if (mara !== -1) colMap.maracana = mara;
      }
      
      const startRow = headerIdx !== -1 ? headerIdx + 1 : 0;
      const groupMap = new Map<string, GroupedProduct>();
      
      for (let i = startRow; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || row.length === 0) continue;
        
        const ref = String(row[colMap.referencia] || "").trim();
        if (!ref || ref === "undefined" || /referencia/i.test(ref)) {
          continue;
        }
        
        const cor = String(row[colMap.cor] || "").trim() || "ÚNICA";
        const desc = String(row[colMap.descricao] || "").trim();
        const ean = String(row[colMap.ean] || "").trim();
        const codBarra = String(row[colMap.codigo_barra] || "").trim();
        const fornecedor = String(row[colMap.fornecedor] || "").trim() || "OUTROS";
        const linha = String(row[colMap.linha] || "").trim() || "GERAL";
        const grupo = String(row[colMap.grupo] || "").trim() || "GERAL";
        const refForn = String(row[colMap.referencia_fornecedor] || "").trim();
        
        // Price parsing
        const precoRaw = row[colMap.preco_varejo];
        let preco = 0;
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
        
        // Sales parsing
        const vendaRaw = row[colMap.venda];
        let venda = 0;
        if (typeof vendaRaw === "number") {
          venda = Math.round(vendaRaw);
        } else if (vendaRaw) {
          venda = parseInt(String(vendaRaw).replace(/[^\d-]/g, ""), 10);
          if (isNaN(venda)) venda = 0;
        }
        
        // Maracana sales parsing
        const maracanaRaw = colMap.maracana !== -1 ? row[colMap.maracana] : undefined;
        let maracanaVenda = 0;
        if (typeof maracanaRaw === "number") {
          maracanaVenda = Math.round(maracanaRaw);
        } else if (maracanaRaw) {
          maracanaVenda = parseInt(String(maracanaRaw).replace(/[^\d-]/g, ""), 10);
          if (isNaN(maracanaVenda)) maracanaVenda = 0;
        }
        
        const tamanho = String(row[colMap.tamanho] || "").trim() || "U";
        
        let modelo = "";
        if (colMap.modelo !== -1) {
          modelo = String(row[colMap.modelo] || "").trim();
        }
        if (!modelo) {
          modelo = linha || "PADRÃO";
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
            linha,
            grupo,
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
      
      const productsList = Array.from(groupMap.values()).sort((a, b) => b.total_vendas - a.total_vendas);
      const nowStr = new Date().toISOString();
      
      // Update state
      setProducts(productsList);
      setLastUpdated(nowStr);
      setFileName(resolvedFileName);
      setTotalCount(productsList.length);
      
      // Save locally (IndexedDB for products, localStorage for metadata)
      await saveToDB("maraca_flu_products", productsList);
      localStorage.setItem("maraca_flu_last_updated", nowStr);
      localStorage.setItem("maraca_flu_file_name", resolvedFileName);
      localStorage.setItem("maraca_flu_total_count", String(productsList.length));
      
      if (isManual) {
        setSyncMessage("Sincronização concluída com sucesso pelo navegador!");
        setTimeout(() => setSyncMessage(null), 3000);
      }
      return true;
    } catch (err: any) {
      console.error("Erro na sincronização pelo navegador:", err);
      if (isManual) {
        setSyncError(err.message || "Erro no processamento local da planilha.");
        setSyncMessage(null);
      }
      return false;
    }
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
      window.location.hostname.includes("fluminense-consulta")
    );

    setSyncing(true);

    if (isVercelHost) {
      // Direct client-side sync on Vercel to bypass the 10-second Serverless Function execution timeout limit
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
              <h1 className="font-display font-black text-xl text-flu-grena tracking-tight uppercase leading-none">
                Maraca Flu
              </h1>
              <p className="text-xs text-slate-400 font-bold tracking-wider uppercase mt-1">
                Consulta de Produtos
              </p>
            </div>
          </div>

          {/* Settings & Manual Sync */}
          <div className="flex items-center gap-3 flex-wrap">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
            />

            <SearchableSelect
              label="Linha"
              icon={<Layers size={11} />}
              value={selectedLinha}
              onChange={setSelectedLinha}
              options={linhaOptions}
              allLabelSales={totalLinhaSales}
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
          <span>© 2026 Maraca Flu — Todos os direitos reservados.</span>
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
        />
      )}
    </div>
  );
}
