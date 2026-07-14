import express from "express";
import path from "path";
import fs from "fs";
import compression from "compression";
import * as XLSX from "xlsx";
import { createServer as createViteServer } from "vite";

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
}

const defaultImageConfig: ImageConfig = {
  baseUrl: "",
  matchField: "referencia",
  extension: "jpg",
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
app.get("/api/products", (req, res) => {
  try {
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
    const { baseUrl, matchField, extension } = req.body;
    const config: ImageConfig = {
      baseUrl: baseUrl || "",
      matchField: matchField || "referencia",
      extension: extension || "jpg",
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

// Helper to resolve Google Drive file ID and name
async function getGoogleDriveFileId(): Promise<{ id: string; name: string }> {
  // Use the direct sheet ID provided by the user
  const defaultFileId = "1oTpB5GtJ6WwEnlhF2LhBcuH5lvw9c7_u";
  const defaultFileName = "Base Maraca Flu.xlsx";

  console.log(`Using direct file ID: ${defaultFileId}`);
  return { id: defaultFileId, name: defaultFileName };
}

// Robust downloader that automatically handles both native Google Sheets and uploaded Excel files (.xlsx)
async function fetchFileFromGoogleDrive(fileId: string): Promise<Buffer> {
  const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  const exportUrl = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=xlsx`;

  // 1. Try the direct download URL first (works for raw Excel uploads, which contain &rtpof=true)
  console.log(`[Google Drive] Trying direct download URL for binary Excel uploads: ${directUrl}`);
  try {
    const directRes = await fetch(directUrl);
    if (directRes.ok) {
      const arrayBuffer = await directRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      // Check for ZIP/XLSX magic bytes (0x50 0x4B) to ensure it is a valid XLSX file and not an HTML login/error page
      if (buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4B) {
        console.log("[Google Drive] Direct download succeeded. Valid ZIP/XLSX file received.");
        return buffer;
      }
      console.log("[Google Drive] Direct download returned a non-XLSX response (missing ZIP magic bytes).");
    } else {
      console.log(`[Google Drive] Direct download failed with status ${directRes.status}: ${directRes.statusText}`);
    }
  } catch (err) {
    console.error("[Google Drive] Error attempting direct download:", err);
  }

  // 2. Try the export URL as a fallback (works for native Google Sheets)
  console.log(`[Google Drive] Trying export URL for native Google Sheets: ${exportUrl}`);
  const exportRes = await fetch(exportUrl);
  if (!exportRes.ok) {
    throw new Error(`Google Drive returned status ${exportRes.status}: ${exportRes.statusText}`);
  }
  const arrayBuffer = await exportRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4B) {
    console.log("[Google Drive] Export download succeeded. Valid ZIP/XLSX file received.");
    return buffer;
  }

  throw new Error("O arquivo retornado pelo Google Drive não é uma planilha válida (formato inválido). Certifique-se de que a planilha está compartilhada publicamente como 'Qualquer pessoa com o link'.");
}

// Core database synchronization function from Google Drive
async function syncDatabase(): Promise<{ success: boolean; lastUpdated: string; fileName: string; totalCount: number; products: any[] }> {
  const { id: targetFileId, name: targetFileName } = await getGoogleDriveFileId();

  // 2. Download the file contents using the robust multi-source downloader
  const buffer = await fetchFileFromGoogleDrive(targetFileId);

  // 3. Parse with SheetJS (XLSX) - OPTIMIZED FOR LARGE DATASETS
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
  const rawRows = XLSX.utils.sheet_to_json<any[]>(worksheet, {
    header: 1,
    raw: true, // Faster raw value extraction
  });

  if (rawRows.length === 0) {
    throw new Error("Nenhum dado encontrado na primeira planilha.");
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
  const groupMap = new Map<string, any>();

  for (let i = startRow; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) continue;

    // Extract reference
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

    // Size parsing
    const tamanho = String(row[colMap.tamanho] || "").trim() || "U";

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

  // Save to disk (best effort cache - minified for maximum performance and minimum size)
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
app.get("/api/sync-status", (req, res) => {
  res.json({
    isSyncing: false,
    lastUpdated: fs.existsSync(PRODUCTS_FILE) ? fs.statSync(PRODUCTS_FILE).mtime.toISOString() : null
  });
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
