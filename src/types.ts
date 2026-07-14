export interface Variation {
  codigo_barra: string;
  ean: string;
  tamanho: string;
  venda: number;
  venda_maracana: number;
}

export interface GroupedProduct {
  referencia: string;
  cor: string;
  descricao: string;
  fornecedor: string;
  modelo: string;
  linha: string;
  grupo: string;
  preco_varejo: number;
  referencia_fornecedor: string;
  total_vendas: number;
  total_vendas_maracana: number;
  variations: Variation[];
}

export interface SyncResponse {
  products: GroupedProduct[];
  lastUpdated: string | null;
  fileName: string | null;
  totalCount: number;
}

export interface ImageConfig {
  baseUrl: string;
  matchField: "referencia" | "referencia_fornecedor" | "ean";
  extension: "jpg" | "png" | "jpeg" | "webp";
  spreadsheetId?: string;
}
