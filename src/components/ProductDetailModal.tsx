import { useState, useEffect } from "react";
import { GroupedProduct, ImageConfig } from "../types";
import { X, Copy, Check, ShoppingBag, Barcode, HelpCircle, ArrowUpRight } from "lucide-react";

interface ProductDetailModalProps {
  product: GroupedProduct | null;
  imageConfig: ImageConfig;
  onClose: () => void;
}

export default function ProductDetailModal({ product, imageConfig, onClose }: ProductDetailModalProps) {
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [imageIndex, setImageIndex] = useState(0);

  // Reset image try index when product changes
  useEffect(() => {
    setImageIndex(0);
  }, [product?.referencia, product?.referencia_fornecedor]);

  if (!product) return null;

  // Format price
  const formatPrice = (price: number) => {
    return price.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  };

  // Construct candidates list based on priority:
  // 1. GitHub supplier reference raw URL: "https://raw.githubusercontent.com/hugotjk/FluminenseConsulta/main/"&referencia_fornecedor&".jpg"
  // 2. GitHub reference raw URL: "https://raw.githubusercontent.com/hugotjk/FluminenseConsulta/main/"&referencia&".jpg"
  // Supports both JPG and PNG, and handles potential Excel decimal formats (like .0)
  const imageUrls: string[] = [];
  const refsToTry: string[] = [];

  if (product.referencia_fornecedor) {
    const rawForn = String(product.referencia_fornecedor).trim();
    if (rawForn) {
      refsToTry.push(rawForn);
      const cleanForn = rawForn.replace(/\.0$/, "");
      if (cleanForn !== rawForn) {
        refsToTry.push(cleanForn);
      }
    }
  }

  if (product.referencia) {
    const rawRef = String(product.referencia).trim();
    if (rawRef) {
      refsToTry.push(rawRef);
      const cleanRef = rawRef.replace(/\.0$/, "");
      if (cleanRef !== rawRef) {
        refsToTry.push(cleanRef);
      }
    }
  }

  // Generate candidates for each unique reference in priority order
  const uniqueRefs = Array.from(new Set(refsToTry));
  for (const ref of uniqueRefs) {
    // 1. Direct raw.githubusercontent.com (preferred - fast, correct CORS, no redirect)
    imageUrls.push(`https://raw.githubusercontent.com/hugotjk/FluminenseConsulta/main/${ref}.jpg`);
    imageUrls.push(`https://raw.githubusercontent.com/hugotjk/FluminenseConsulta/main/${ref}.png`);
    // 2. Direct github.com with raw=true (fallback redirect)
    imageUrls.push(`https://github.com/hugotjk/FluminenseConsulta/blob/main/${ref}.jpg?raw=true`);
    imageUrls.push(`https://github.com/hugotjk/FluminenseConsulta/blob/main/${ref}.png?raw=true`);
  }

  if (imageConfig.baseUrl) {
    let identifier = "";
    if (imageConfig.matchField === "referencia") {
      identifier = product.referencia;
    } else if (imageConfig.matchField === "referencia_fornecedor") {
      identifier = product.referencia_fornecedor;
    } else if (imageConfig.matchField === "ean") {
      identifier = product.variations?.[0]?.ean || "";
    }
    if (identifier) {
      const base = imageConfig.baseUrl.endsWith("/") ? imageConfig.baseUrl : `${imageConfig.baseUrl}/`;
      imageUrls.push(`${base}${identifier}.${imageConfig.extension}`);
    }
  }

  const currentImageUrl = imageIndex < imageUrls.length ? imageUrls[imageIndex] : null;
  const showPlaceholder = !currentImageUrl;

  const handleImageError = () => {
    setImageIndex((prev) => prev + 1);
  };

  const handleCopy = (text: string, type: "ean" | "code") => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  return (
    <div 
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 animate-backdrop-in cursor-pointer"
    >
      <div
        id="product-detail-modal"
        className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col relative animate-fade-in cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Fluminense colored header stripe */}
        <div className="h-2 w-full flex flex-row">
          <div className="flex-1 bg-flu-grena" />
          <div className="flex-1 bg-flu-verde" />
        </div>

        {/* Modal Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-all duration-200 z-10"
        >
          <X size={20} />
        </button>

        <div className="overflow-y-auto p-6 md:p-8 space-y-6">
          {/* Main Info Section (Split on large screens) */}
          <div className="flex flex-col md:flex-row gap-6 items-start">
            {/* Left side: Product Image */}
            <div className="w-full md:w-48 h-48 bg-slate-50 border border-slate-100 rounded-2xl flex flex-col justify-center items-center overflow-hidden relative shrink-0">
              {!showPlaceholder && currentImageUrl ? (
                <img
                  src={currentImageUrl}
                  alt={product.descricao}
                  referrerPolicy="no-referrer"
                  onError={handleImageError}
                  className="w-full h-full object-contain p-2"
                />
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <ShoppingBag className="text-slate-200" size={36} />
                  <span className="text-xs font-black text-slate-300 tracking-wider">SEM FOTO</span>
                </div>
              )}
            </div>

            {/* Right side: Summary Details */}
            <div className="flex-1 space-y-3">
              <div className="space-y-1">
                <span className="text-[10px] font-black text-white tracking-wider uppercase bg-flu-verde px-2.5 py-1 rounded-full inline-block">
                  {product.fornecedor}
                </span>
                <h2 className="font-sans font-black text-lg md:text-xl text-slate-800 uppercase leading-snug">
                  {product.descricao}
                </h2>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="bg-slate-50/70 p-2.5 rounded-xl border border-slate-100">
                  <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Referência</div>
                  <div className="text-sm font-black text-slate-700 font-mono mt-0.5">{product.referencia}</div>
                </div>
                {product.referencia_fornecedor && (
                  <div className="bg-slate-50/70 p-2.5 rounded-xl border border-slate-100">
                    <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Ref. Fornecedor</div>
                    <div className="text-sm font-black text-slate-700 font-mono mt-0.5">{product.referencia_fornecedor}</div>
                  </div>
                )}
                <div className="bg-slate-50/70 p-2.5 rounded-xl border border-slate-100">
                  <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Grupo</div>
                  <div className="text-sm font-bold text-slate-700 mt-0.5">{product.grupo}</div>
                </div>
                <div className="bg-slate-50/70 p-2.5 rounded-xl border border-slate-100">
                  <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Linha</div>
                  <div className="text-sm font-bold text-slate-700 mt-0.5">{product.linha}</div>
                </div>
              </div>

              <div className="pt-2 flex items-baseline gap-4">
                <div className="text-2xl font-black text-flu-grena">
                  {formatPrice(product.preco_varejo)}
                </div>
              </div>
            </div>
          </div>

          {/* Sizes & Variation List */}
          <div className="space-y-3">
            <h3 className="font-sans font-black text-sm text-slate-700 uppercase tracking-wider border-b border-slate-100 pb-2">
              Grades de Tamanhos & Códigos (Variações)
            </h3>

            <div className="border border-slate-100 rounded-2xl overflow-hidden bg-slate-50/30">
              <div className="grid grid-cols-10 bg-slate-100/70 py-2.5 px-4 text-[11px] font-black uppercase text-slate-500 tracking-wider">
                <div className="col-span-2">Tam</div>
                <div className="col-span-4">Cód. Barra</div>
                <div className="col-span-4">EAN</div>
              </div>

              <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
                {product.variations.map((v, idx) => (
                  <div
                    key={`${v.tamanho}-${v.codigo_barra}-${idx}`}
                    className="grid grid-cols-10 py-3 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors duration-150 items-center"
                  >
                    {/* Size badge */}
                    <div className="col-span-2">
                      <span className="bg-slate-200/80 text-slate-700 text-[11px] font-bold px-2 py-0.5 rounded-md min-w-8 text-center inline-block">
                        {v.tamanho}
                      </span>
                    </div>

                    {/* Barcode with copy */}
                    <div className="col-span-4 flex items-center gap-1 font-mono text-[11px]">
                      <span className="truncate">{v.codigo_barra || "—"}</span>
                      {v.codigo_barra && (
                        <button
                          onClick={() => handleCopy(v.codigo_barra, "code")}
                          className="p-1 text-slate-400 hover:text-flu-grena rounded-md hover:bg-slate-100 transition-colors duration-150 shrink-0"
                          title="Copiar código de barra"
                        >
                          {copiedText === v.codigo_barra ? (
                            <Check className="text-emerald-600" size={12} />
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>
                      )}
                    </div>

                    {/* EAN with copy */}
                    <div className="col-span-4 flex items-center gap-1 font-mono text-[11px]">
                      <span className="truncate">{v.ean || "—"}</span>
                      {v.ean && (
                        <button
                          onClick={() => handleCopy(v.ean, "ean")}
                          className="p-1 text-slate-400 hover:text-flu-grena rounded-md hover:bg-slate-100 transition-colors duration-150 shrink-0"
                          title="Copiar EAN"
                        >
                          {copiedText === v.ean ? (
                            <Check className="text-emerald-600" size={12} />
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Action / Help Footer */}
        <div className="bg-slate-50 p-4 border-t border-slate-100 flex flex-row items-center justify-between text-[11px] text-slate-400 font-semibold">
          <div className="flex items-center gap-1">
            <Barcode size={13} />
            <span>Toque em copiar para transferir o código</span>
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-flu-grena hover:bg-red-950 text-white font-bold text-xs rounded-xl transition-all duration-200 uppercase tracking-wider"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
