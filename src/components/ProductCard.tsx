import { useState, useEffect } from "react";
import { GroupedProduct, ImageConfig } from "../types";
import { ShoppingBag } from "lucide-react";

interface ProductCardProps {
  product: GroupedProduct;
  imageConfig: ImageConfig;
  onClick: () => void;
  currentTab?: "geral" | "maracana";
  key?: string;
}

export default function ProductCard({ product, imageConfig, onClick, currentTab = "geral" }: ProductCardProps) {
  const [imageIndex, setImageIndex] = useState(0);

  // Reset image try index when product changes
  useEffect(() => {
    setImageIndex(0);
  }, [product.referencia, product.referencia_fornecedor]);

  // Construct candidates list based on priority:
  // 1. GitHub JPG: "https://github.com/hugotjk/FluminenseConsulta/blob/main/"&referencia_fornecedor&".jpg?raw=true"
  // 2. GitHub PNG: "https://github.com/hugotjk/FluminenseConsulta/blob/main/"&referencia_fornecedor&".png?raw=true"
  // 3. User configured fallback (if any)
  const imageUrls: string[] = [];
  if (product.referencia_fornecedor) {
    const trimmedFornRef = product.referencia_fornecedor.trim();
    if (trimmedFornRef) {
      imageUrls.push(`https://github.com/hugotjk/FluminenseConsulta/blob/main/${trimmedFornRef}.jpg?raw=true`);
      imageUrls.push(`https://github.com/hugotjk/FluminenseConsulta/blob/main/${trimmedFornRef}.png?raw=true`);
    }
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

  // Format price
  const formatPrice = (price: number) => {
    return price.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  };

  // Extract list of distinct sizes
  const sizesList = product.variations
    .map((v) => v.tamanho)
    .filter((v, idx, self) => self.indexOf(v) === idx)
    .join(", ");

  return (
    <div
      id={`product-card-${product.referencia}`}
      onClick={onClick}
      className="bg-white rounded-2xl border border-slate-100 shadow-[0_2px_12px_rgba(0,0,0,0.02)] hover:shadow-[0_6px_20px_rgba(0,0,0,0.06)] hover:scale-[1.01] transition-all duration-300 p-2.5 sm:p-4 flex flex-row items-center justify-between h-[6.8rem] sm:h-[9.5rem] cursor-pointer relative overflow-hidden group select-none gap-2 sm:gap-4"
    >
      {/* Decorative colored top accent representing Fluminense (Grená and Green) */}
      <div className="absolute top-0 left-0 right-0 h-1 flex flex-row">
        <div className="flex-1 bg-flu-grena" />
        <div className="flex-1 bg-flu-verde" />
      </div>

      {/* Main product info on the left */}
      <div className="flex flex-col justify-between h-full min-w-0 flex-1 py-0.5">
        <div className="flex flex-col min-w-0">
          {/* Description */}
          <h3 className="font-sans font-bold text-[9.5px] sm:text-xs tracking-tight text-[#1e293b] uppercase line-clamp-2 leading-tight group-hover:text-flu-grena transition-colors duration-200" title={product.descricao}>
            {product.descricao}
          </h3>

          {/* Reference IDs */}
          <div className="mt-1 sm:mt-1.5 space-y-0.5">
            <div className="text-[8px] sm:text-[10px] font-medium text-slate-400 truncate">
              REF: <span className="text-slate-600 font-mono font-semibold">{product.referencia}</span>
            </div>
            {product.referencia_fornecedor && (
              <div className="text-[8px] sm:text-[10px] font-medium text-slate-400 truncate">
                FORN: <span className="text-slate-600 font-mono font-semibold">{product.referencia_fornecedor}</span>
              </div>
            )}
          </div>
        </div>

        {/* Price at the bottom */}
        <div className="text-[10.5px] sm:text-sm font-black text-flu-grena leading-none mt-1">
          {formatPrice(product.preco_varejo)}
        </div>
      </div>

      {/* Image box on the right (reduced size photo) */}
      <div className="w-[3.4rem] h-[3.4rem] sm:w-[5.8rem] sm:h-[5.8rem] bg-slate-50/50 border border-slate-100/60 rounded-xl flex flex-col justify-center items-center overflow-hidden shrink-0 relative group-hover:bg-slate-100/30 transition-colors duration-300">
        {!showPlaceholder && currentImageUrl ? (
          <img
            src={currentImageUrl}
            alt={product.descricao}
            referrerPolicy="no-referrer"
            onError={handleImageError}
            className="w-full h-full object-contain p-1 transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex flex-col items-center gap-0.5">
            <ShoppingBag className="text-slate-200" size={12} />
            <span className="text-[7.5px] font-black text-slate-300 tracking-wider">SEM FOTO</span>
          </div>
        )}
      </div>
    </div>
  );
}
