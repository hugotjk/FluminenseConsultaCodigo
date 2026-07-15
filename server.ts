import express from "express";
import path from "path";
import fs from "fs";
import compression from "compression";
import * as XLSX from "xlsx";
import { saveProductsToFirestore, loadProductsFromFirestore } from "./src/utils/firebase";

const app = express();
const PORT = 3000;

app.use(compression());
app.use(express.json());

// Ensure data directory exists
const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.warn("Could not create data directory (normal in read-only environments):", e);
  }
}

const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const IMAGE_CONFIG_FILE = path.join(DATA_DIR, "image_config.json");

// Default image configuration
interface ImageConfig {
  baseUrl: string;
  matchField: "referencia" | "referencia_fornecedor" | "ean";
  extension: "jpg" | "png" | "jpeg" | "webp";
  spreadsheetId?: string;
}

const defaultImageConfig: ImageConfig = {
  baseUrl: "",
  matchField: "referencia",
  extension: "jpg",
  spreadsheetId: "1oTpB5GtJ6WwEnlhF2LhBcuH5lvw9c7_u",
};

// Helper to get image config
function getImageConfig(): ImageConfig {
  try {
    if (fs.existsSync(IMAGE_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(IMAGE_CONFIG_FILE, "utf-8"));
    }
  } catch (err) {
    console.error("Error reading image config:", err);
  }
  return defaultImageConfig;
}

// Get products from cached file
app.get("/api/products", async (req, res) => {
  try {
    // 1. Try loading from Firestore first (critical for Vercel/serverless environments)
    console.log("Endpoint /api/products: loading from Firestore...");
    const firestoreData = await loadProductsFromFirestore();
    if (firestoreData && firestoreData.products && firestoreData.products.length > 0) {
      console.log(`Endpoint /api/products: loaded ${firestoreData.products.length} products from Firestore`);
      return res.json(firestoreData);
    }
    
    // 2. Fallback to local products.json file if Firestore is empty/failed
    console.log("Endpoint /api/products: Firestore empty or failed, falling back to local file...");
    if (fs.existsSync(PRODUCTS_FILE)) {
      const data = JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf-8"));
      return res.json(data);
    }
    return res.json({ products: [], lastUpdated: null, fileName: null });
  } catch (err: any) {
    console.error("Error reading products:", err);
    return res.status(500).json({ error: "Failed to read products database" });
  }
});

// Get image config
app.get("/api/image-config", (req, res) => {
  res.json(getImageConfig());
});

// Update image config
app.post("/api/image-config", (req, res) => {
  try {
    const { baseUrl, matchField, extension, spreadsheetId } = req.body;
    const config: ImageConfig = {
      baseUrl: baseUrl || "",
      matchField: matchField || "referencia",
      extension: extension || "jpg",
      spreadsheetId: spreadsheetId || "1oTpB5GtJ6WwEnlhF2LhBcuH5lvw9c7_u",
    };
    try {
      fs.writeFileSync(IMAGE_CONFIG_FILE, JSON.stringify(config, null, 2));
    } catch (writeErr) {
      console.warn("Failed to write image config to disk (normal on serverless/Vercel):", writeErr);
    }
    res.json({ success: true, config });
  } catch (err: any) {
    console.error("Error saving image config:", err);
    res.status(500).json({ error: "Failed to save image configuration" });
  }
});

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

// Helper to resolve Google Drive file ID and name
async function getGoogleDriveFileId(): Promise<{ id: string; name: string }> {
  // Use the configured spreadsheetId or fallback to the default
  const config = getImageConfig();
  const rawId = config.spreadsheetId || "1oTpB5GtJ6WwEnlhF2LhBcuH5lvw9c7_u";
  const defaultFileId = extractGoogleDriveId(rawId);
  const defaultFileName = "Base Maraca Flu.xlsx";

  console.log(`Using dynamic file ID: ${defaultFileId} (extracted from original: ${rawId})`);
  return { id: defaultFileId, name: defaultFileName };
}

// Helper to fetch a URL with timeout, retries, and browser headers
async function fetchWithRetry(url: string, retries = 3, delayMs = 1000): Promise<Response> {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  };

  for (let i = 0; i < retries; i++) {
    try {
      console.log(`[Google Drive] Fetching (Attempt ${i + 1}/${retries}): ${url}`);
      const res = await fetch(url, { headers });
      if (res.ok) {
        return res;
      }
      console.warn(`[Google Drive] Attempt ${i + 1} returned status ${res.status}: ${res.statusText}`);
    } catch (err) {
      console.warn(`[Google Drive] Attempt ${i + 1} threw error:`, err);
    }
    if (i < retries - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`Failed to fetch from ${url} after ${retries} attempts`);
}

// Robust downloader that automatically handles both native Google Sheets and uploaded Excel files (.xlsx)
async function fetchFileFromGoogleDrive(fileId: string): Promise<Buffer> {
  const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  const exportUrl = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=xlsx`;
  const exportGidUrl = `https://docs.google.com/spreadsheets/d/${fileId}/export?gid=0&format=xlsx`;

  const urlsToTry = [
    { url: directUrl, desc: "direct download URL for binary Excel uploads" },
    { url: exportUrl, desc: "export URL for native Google Sheets" },
    { url: exportGidUrl, desc: "explicit sheet export URL" }
  ];

  for (const item of urlsToTry) {
    console.log(`[Google Drive] Trying ${item.desc}: ${item.url}`);
    try {
      const res = await fetchWithRetry(item.url, 2, 800);
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      // Check for ZIP/XLSX magic bytes (0x50 0x4B) to ensure it is a valid XLSX file and not an HTML login/error page
      if (buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4B) {
        console.log(`[Google Drive] Success using ${item.desc}. Valid ZIP/XLSX file received.`);
        return buffer;
      }
      console.log(`[Google Drive] ${item.desc} returned a non-XLSX response (missing ZIP magic bytes). Length: ${buffer.length}`);
    } catch (err) {
      console.error(`[Google Drive] Error attempting ${item.desc}:`, err);
    }
  }

  throw new Error("O arquivo retornado pelo Google Drive não pôde ser baixado ou não é uma planilha válida (formato inválido). Certifique-se de que a planilha está compartilhada publicamente como 'Qualquer pessoa com o link'.");
}

// Custom high-performance CSV parser that handles quotes and delimiters
function parseCSV(text: string): string[][] {
  const firstLineEnd = text.indexOf('\n');
  const firstLine = firstLineEnd !== -1 ? text.substring(0, firstLineEnd) : text;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const delimiter = semicolonCount > commaCount ? ';' : ',';

  const rows: string[][] = [];
  let currentLine: string[] = [];
  let currentCell = '';
  let inQuotes = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i+1];
    
    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentCell += '"';
          i++; // Skip next quote
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        currentLine.push(currentCell);
        currentCell = '';
      } else if (char === '\n' || char === '\r') {
        currentLine.push(currentCell);
        if (currentLine.length > 1 || (currentLine.length === 1 && currentLine[0] !== '')) {
          rows.push(currentLine);
        }
        currentLine = [];
        currentCell = '';
        if (char === '\r' && nextChar === '\n') {
          i++; // Skip LF
        }
      } else {
        currentCell += char;
      }
    }
  }
  if (currentCell !== '' || currentLine.length > 0) {
    currentLine.push(currentCell);
    rows.push(currentLine);
  }
  return rows;
}

// Core database synchronization function from Google Drive
async function syncDatabase(): Promise<{ success: boolean; lastUpdated: string; fileName: string; totalCount: number; products: any[] }> {
  const { id: targetFileId, name: targetFileName } = await getGoogleDriveFileId();
  let rawRows: any[][] = [];
  let parsedViaCSV = false;

  // Attempt 1: Fast CSV export download & parse (takes <2 seconds end-to-end, completely safe from 10s serverless timeout)
  console.log("[Sync] Attempting lightning-fast CSV sync...");
  try {
    const csvUrl = `https://docs.google.com/spreadsheets/d/${targetFileId}/export?format=csv`;
    const csvRes = await fetchWithRetry(csvUrl, 2, 800);
    const csvText = await csvRes.text();
    
    if (csvText.length > 100 && !csvText.trim().startsWith("<!DOCTYPE") && (csvText.toLowerCase().includes("referencia") || csvText.toLowerCase().includes("descri") || csvText.toLowerCase().includes("codigo"))) {
      console.log(`[Sync] Valid CSV received (${csvText.length} characters). Parsing...`);
      rawRows = parseCSV(csvText);
      parsedViaCSV = true;
      console.log(`[Sync] CSV parsing completed. Row count: ${rawRows.length}`);
    } else {
      console.warn("[Sync] Received invalid CSV response (looks like HTML or empty). Falling back to XLSX...");
    }
  } catch (csvErr) {
    console.warn("[Sync] Fast CSV sync failed, falling back to XLSX sync. Error:", csvErr);
  }

  // Attempt 2: Fallback to binary XLSX downloading & SheetJS parsing
  if (!parsedViaCSV) {
    console.log("[Sync] Executing fallback XLSX download & SheetJS parse (might hit 10s serverless timeout)...");
    const buffer = await fetchFileFromGoogleDrive(targetFileId);
    
    const metaWorkbook = XLSX.read(buffer, { type: "buffer", bookSheets: true });
    if (metaWorkbook.SheetNames.length === 0) {
      throw new Error("O arquivo Excel baixado está vazio.");
    }

    const sheetName = metaWorkbook.SheetNames[0];
    const workbook = XLSX.read(buffer, {
      type: "buffer",
      sheets: [sheetName],
      cellFormula: false,
      cellHTML: false,
      cellNF: false,
      cellStyles: false,
      cellText: false,
    });

    const worksheet = workbook.Sheets[sheetName];
    rawRows = XLSX.utils.sheet_to_json<any[]>(worksheet, {
      header: 1,
      raw: true, // Faster raw value extraction
    });
  }

  if (rawRows.length === 0) {
    throw new Error("Nenhum dado encontrado na planilha.");
  }

  // 4. Group products by Referência and Cor, sum sales
  // First, let's identify headers and build column mapping
  let headerIdx = -1;
  for (let i = 0; i < Math.min(15, rawRows.length); i++) {
    const r = rawRows[i];
    if (r && r.some(cell => /referencia|referência|descri|código|barra/i.test(String(cell)))) {
      headerIdx = i;
      break;
    }
  }

  // Default indices if headers not detected
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
          String(h)
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
  }

  const startRow = headerIdx !== -1 ? headerIdx + 1 : 0;
  const groupMap = new Map<string, any>();

  for (let i = startRow; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) continue;

    // Extract reference
    const ref = colMap.referencia !== -1 ? String(row[colMap.referencia] || "").trim() : "";
    if (!ref || ref === "undefined" || /referencia/i.test(ref)) {
      continue;
    }

    const cor = colMap.cor !== -1 ? String(row[colMap.cor] || "").trim() || "ÚNICA" : "ÚNICA";
    const desc = colMap.descricao !== -1 ? String(row[colMap.descricao] || "").trim() : "";
    const ean = colMap.ean !== -1 ? String(row[colMap.ean] || "").trim() : "";
    const codBarra = colMap.codigo_barra !== -1 ? String(row[colMap.codigo_barra] || "").trim() : "";
    const fornecedor = colMap.fornecedor !== -1 ? String(row[colMap.fornecedor] || "").trim() || "OUTROS" : "OUTROS";
    const linha = colMap.linha !== -1 ? String(row[colMap.linha] || "").trim() || "GERAL" : "GERAL";
    const grupo = colMap.grupo !== -1 ? String(row[colMap.grupo] || "").trim() || "GERAL" : "GERAL";
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

    // Size parsing
    const tamanho = colMap.tamanho !== -1 ? String(row[colMap.tamanho] || "").trim() || "U" : "U";

    // Modelo parsing
    let modelo = "";
    if (colMap.modelo !== -1) {
      modelo = String(row[colMap.modelo] || "").trim();
    }
    if (!modelo) {
      modelo = linha || "PADRÃO"; // Fallback to Linha as requested
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

  // Convert map to array and sort by total_vendas descending
  const products = Array.from(groupMap.values()).sort((a, b) => b.total_vendas - a.total_vendas);

  const syncResult = {
    products,
    lastUpdated: new Date().toISOString(),
    fileName: targetFileName,
    fileId: targetFileId,
    totalCount: products.length,
  };

  // 1. Save to Firestore (primary master copy for all environments, especially serverless)
  try {
    await saveProductsToFirestore(products, {
      lastUpdated: syncResult.lastUpdated,
      totalCount: products.length,
      fileName: targetFileName,
      fileId: targetFileId,
    });
    console.log("Database successfully saved to Firestore!");
  } catch (err) {
    console.error("Failed to save synchronized database to Firestore:", err);
  }

  // 2. Save to disk (best effort local cache)
  try {
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(syncResult));
    console.log(`Database synchronized successfully! Total products grouped: ${products.length}`);
  } catch (err) {
    console.warn("Could not write products cache to disk (this is normal in serverless/Vercel):", err);
  }

  return {
    success: true,
    lastUpdated: syncResult.lastUpdated,
    fileName: syncResult.fileName,
    totalCount: syncResult.totalCount,
    products: syncResult.products, // Return products so client can store them in localStorage
  };
}

let isSyncing = false;

// Sync database from Google Drive without authentication (runs synchronously to support serverless / Vercel execution context)
app.post("/api/sync", async (req, res) => {
  if (isSyncing) {
    return res.status(409).json({ error: "Sincronização já em andamento. Aguarde alguns instantes." });
  }

  isSyncing = true;
  console.log("Starting server-side synchronous sync from /api/sync...");
  
  try {
    const result = await syncDatabase();
    console.log(`Server-side sync finished successfully. Count: ${result.totalCount}`);
    return res.json(result);
  } catch (err: any) {
    console.error("Server-side sync failed:", err);
    return res.status(500).json({ error: err.message || "Erro interno durante a sincronização" });
  } finally {
    isSyncing = false;
  }
});

// Endpoint to check background sync status (kept for compatibility, always returning not syncing now that it is synchronous)
app.get("/api/sync-status", async (req, res) => {
  try {
    const firestoreData = await loadProductsFromFirestore();
    res.json({
      isSyncing: false,
      lastUpdated: firestoreData ? firestoreData.lastUpdated : (fs.existsSync(PRODUCTS_FILE) ? fs.statSync(PRODUCTS_FILE).mtime.toISOString() : null)
    });
  } catch (err) {
    res.json({
      isSyncing: false,
      lastUpdated: fs.existsSync(PRODUCTS_FILE) ? fs.statSync(PRODUCTS_FILE).mtime.toISOString() : null
    });
  }
});

// Global cache variables to persist across warm serverless container instances on Vercel
let cachedBuffer: Buffer | null = null;
let cachedFileId: string | null = null;
let cachedTime = 0;
let downloadPromise: Promise<Buffer> | null = null;

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache window for parallel chunk sync
const CACHE_FILE_PATH = path.join("/tmp", "drive_cache_maraca.xlsx");

async function getFileWithCache(fileId: string, bypassCache: boolean): Promise<Buffer> {
  const now = Date.now();

  // 1. If NOT bypassing cache, serve from warm memory cache
  if (!bypassCache && cachedBuffer && cachedFileId === fileId && (now - cachedTime < CACHE_TTL_MS)) {
    console.log("Serving Google Drive file from warm memory cache.");
    return cachedBuffer;
  }

  // 2. If there is a concurrent download in progress, join it to prevent cache stampede
  if (downloadPromise) {
    console.log("Joining existing concurrent Google Drive download promise...");
    return downloadPromise;
  }

  // 3. If NOT bypassing cache, check cold disk cache in the /tmp folder
  if (!bypassCache) {
    try {
      const stats = fs.existsSync(CACHE_FILE_PATH) ? fs.statSync(CACHE_FILE_PATH) : null;
      if (stats && (now - stats.mtimeMs < CACHE_TTL_MS)) {
        console.log("Serving Google Drive file from /tmp disk cache.");
        const diskBuffer = fs.readFileSync(CACHE_FILE_PATH);
        cachedBuffer = diskBuffer;
        cachedFileId = fileId;
        cachedTime = stats.mtimeMs;
        return diskBuffer;
      }
    } catch (err) {
      console.warn("Error reading from /tmp disk cache:", err);
    }
  }

  // 4. Download from Google Drive and populate cache
  console.log(`Downloading fresh spreadsheet from Google Drive (bypassCache: ${bypassCache})`);
  downloadPromise = (async () => {
    try {
      const buffer = await fetchFileFromGoogleDrive(fileId);

      // Save to memory cache
      cachedBuffer = buffer;
      cachedFileId = fileId;
      cachedTime = Date.now();

      // Save to disk cache (/tmp is writeable in Vercel serverless functions)
      try {
        fs.writeFileSync(CACHE_FILE_PATH, buffer);
        console.log("Excel spreadsheet successfully cached to /tmp disk.");
      } catch (writeErr) {
        console.warn("Could not write cache file to /tmp:", writeErr);
      }

      return buffer;
    } finally {
      downloadPromise = null;
    }
  })();

  return downloadPromise;
}

// Proxy endpoint to stream raw XLSX file to the client for frontend parsing fallback (bypasses CORS and server-side timeouts)
app.get("/api/download-excel", async (req, res) => {
  try {
    const bypassCache = req.query.bypassCache === "1" || req.query.force === "1";
    const { id: targetFileId, name: targetFileName } = await getGoogleDriveFileId();
    
    // Download using the intelligent cache helper
    const buffer = await getFileWithCache(targetFileId, bypassCache);
    const totalLength = buffer.length;

    res.setHeader("X-File-Name", encodeURIComponent(targetFileName));
    res.setHeader("Content-Type", "application/octet-stream");


    // Supports dynamic chunk size to completely avoid Vercel's 4.5MB response limit
    const requestedChunkSize = req.query.chunkSize ? parseInt(req.query.chunkSize as string, 10) : 2000000; // Default 2MB chunks
    const chunkSize = isNaN(requestedChunkSize) ? 2000000 : requestedChunkSize;
    const totalParts = Math.ceil(totalLength / chunkSize);

    if (req.query.info === "1") {
      return res.json({
        success: true,
        fileName: targetFileName,
        totalLength,
        totalParts,
        chunkSize
      });
    }

    if (req.query.part) {
      const part = parseInt(req.query.part as string, 10);
      if (isNaN(part) || part < 1) {
        return res.status(400).json({ error: "Número de parte inválido" });
      }

      // Backward compatibility for old hardcoded part=1 (3MB) and part=2 (remainder)
      if (!req.query.chunkSize && (part === 1 || part === 2) && totalParts <= 2) {
        if (part === 1) {
          const chunk = buffer.subarray(0, 3000000);
          return res.send(chunk);
        } else {
          const chunk = buffer.subarray(3000000);
          return res.send(chunk);
        }
      }

      const start = (part - 1) * chunkSize;
      const end = Math.min(start + chunkSize, totalLength);
      
      if (start >= totalLength) {
        return res.status(416).json({ error: "Requested range not satisfiable" });
      }

      const chunk = buffer.subarray(start, end);
      return res.send(chunk);
    }

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(targetFileName)}"`);
    return res.send(buffer);
  } catch (err: any) {
    console.error("Proxy Download Error:", err);
    return res.status(500).json({ error: err.message || "Erro ao baixar arquivo do Google Drive" });
  }
});

// Configure development or production middleware
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // Integrate Vite in development mode
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve production static assets
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);

      // Initial background sync on boot
      console.log("Triggering initial background sync on server boot...");
      syncDatabase()
        .then((res) => console.log(`Initial boot sync completed. Grouped products count: ${res.totalCount}`))
        .catch((err) => console.error("Initial boot sync failed:", err));

      // Scheduled background sync every 4 hours (4 * 60 * 60 * 1000 ms)
      const FOUR_HOURS = 4 * 60 * 60 * 1000;
      setInterval(() => {
        console.log("Starting scheduled 4-hour background database sync...");
        syncDatabase()
          .then((res) => console.log(`Scheduled background sync completed successfully. Count: ${res.totalCount}`))
          .catch((err) => console.error("Scheduled background sync failed:", err));
      }, FOUR_HOURS);
    });
  } else {
    console.log("Running in serverless mode (Vercel). Server listening and initial sync background tasks are skipped.");
  }
}

startServer();

export default app;
