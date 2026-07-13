import express from "express";
import path from "path";
import fs from "fs";
import * as XLSX from "xlsx";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = 3000;

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

// Core database synchronization function from Google Drive
async function syncDatabase(): Promise<{ success: boolean; lastUpdated: string; fileName: string; totalCount: number; products: any[] }> {
  const folderId = "1Fsec9Mlh1-ktpuIN3DOOC_A0IakfWd13";
  const defaultFileId = "1oTpB5GtJ6WwEnlhF2LhBcuH5lvw9c7_u";
  let targetFileId = "";
  let targetFileName = "Base Maraca Flu.xlsx";

  console.log("Fetching public Google Drive folder page...");
  try {
    const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
    const folderRes = await fetch(folderUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
      }
    });

    if (folderRes.ok) {
      const html = await folderRes.text();
      const pattern = /window\['_DRIVE_ivd'\]\s*=\s*'([^']*)'/;
      const match = html.match(pattern);

      if (match) {
        const hexEncoded = match[1];
        const decoded = hexEncoded.replace(/\\x([0-9a-fA-F]{2})/g, (m, g1) => {
          return String.fromCharCode(parseInt(g1, 16));
        });
        try {
          const parsed = JSON.parse(decoded);
          if (Array.isArray(parsed) && Array.isArray(parsed[0])) {
            const files = parsed[0];
            // Filter files whose name contains 'Base Maraca Flu' and is an xlsx
            const matchedFiles = files.filter((f: any) => {
              const name = String(f[2] || "");
              return name.includes("Base Maraca Flu") && name.endsWith(".xlsx");
            });

            if (matchedFiles.length > 0) {
              // Sort by modified time (index 10) descending to get the newest
              matchedFiles.sort((a: any, b: any) => {
                const timeA = a[10] || 0;
                const timeB = b[10] || 0;
                return timeB - timeA;
              });
              targetFileId = matchedFiles[0][0];
              targetFileName = matchedFiles[0][2];
              console.log(`Found file in public folder: ${targetFileName} (ID: ${targetFileId})`);
            }
          }
        } catch (parseErr) {
          console.error("Error parsing folder data from HTML:", parseErr);
        }
      }

      // Fallback if scraping window['_DRIVE_ivd'] failed or couldn't find file:
      // Try to regex parse the HTML directly for any table/list rows
      if (!targetFileId) {
        console.log("Attempting fallback direct regex match for file ID and name...");
        const regexId = /data-id="([a-zA-Z0-9_-]{33})"/g;
        const allIds: string[] = [];
        let m;
        while ((m = regexId.exec(html)) !== null) {
          if (!allIds.includes(m[1]) && m[1] !== folderId) {
            allIds.push(m[1]);
          }
        }
        if (allIds.length > 0) {
          targetFileId = allIds[0];
          console.log(`Fallback picked first found file ID: ${targetFileId}`);
        }
      }
    } else {
      console.warn(`Google Drive folder page returned status ${folderRes.status}. Falling back to default.`);
    }
  } catch (err) {
    console.warn("Failed to scrape folder page (this is normal in Vercel/serverless due to rate limits):", err);
  }

  // Final fallback to the proven file ID
  if (!targetFileId) {
    console.log(`Using default hardcoded file ID: ${defaultFileId}`);
    targetFileId = defaultFileId;
    targetFileName = "Base Maraca Flu.xlsx (Direto)";
  }

  // 2. Download the file contents
  const downloadUrl = `https://docs.google.com/spreadsheets/d/${targetFileId}/export?format=xlsx`;
  console.log(`Downloading file from: ${downloadUrl}`);
  const downloadResponse = await fetch(downloadUrl);

  if (!downloadResponse.ok) {
    throw new Error(`Falha ao baixar arquivo do Google Drive: ${downloadResponse.statusText}`);
  }

  const arrayBuffer = await downloadResponse.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // 3. Parse with SheetJS (XLSX)
  const workbook = XLSX.read(buffer, { type: "buffer" });
  if (workbook.SheetNames.length === 0) {
    throw new Error("The downloaded Excel file is empty.");
  }

  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });

  if (rawRows.length === 0) {
    throw new Error("No data found inside the first sheet.");
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

  // Save to disk (best effort cache)
  try {
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(syncResult, null, 2));
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

// Sync database from Google Drive without authentication
app.post("/api/sync", async (req, res) => {
  try {
    const result = await syncDatabase();
    return res.json(result);
  } catch (err: any) {
    console.error("Critical Sync Error:", err);
    return res.status(500).json({ error: err.message || "Erro interno durante a sincronização" });
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
