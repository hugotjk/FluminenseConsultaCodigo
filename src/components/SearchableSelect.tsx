import React, { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Search, ChevronDown, Check, X } from "lucide-react";

interface SearchableSelectProps {
  label: string;
  icon?: React.ReactNode;
  value: string;
  onChange: (val: string) => void;
  options: Array<[string, { count: number; sales: number }]>;
  placeholder?: string;
  allLabelSales: number;
  align?: "left" | "right";
}

export default function SearchableSelect({
  label,
  icon,
  value,
  onChange,
  options,
  placeholder = "TODOS",
  allLabelSales,
  align = "left",
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);

  // Close when clicking outside (including clicking outside of portal)
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (containerRef.current && containerRef.current.contains(target)) {
        return;
      }
      if (dropdownRef.current && dropdownRef.current.contains(target)) {
        return;
      }
      setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Update dropdown coordinates relative to the screen/body
  useEffect(() => {
    if (!isOpen) return;

    function updateCoords() {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        const scrollY = window.pageYOffset || document.documentElement.scrollTop;
        const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
        
        // Calculate the ideal left position
        const leftVal = align === "right" ? rect.right + scrollX - 256 : rect.left + scrollX;
        // Keep inside the viewport bounds with a 10px padding
        const computedLeft = Math.max(10, Math.min(window.innerWidth - 266, leftVal));

        setCoords({
          top: rect.bottom + scrollY,
          left: computedLeft,
          width: rect.width,
        });
      }
    }

    updateCoords();
    
    // Listen to scroll and resize to keep positioned correctly
    window.addEventListener("scroll", updateCoords, true);
    window.addEventListener("resize", updateCoords);

    return () => {
      window.removeEventListener("scroll", updateCoords, true);
      window.removeEventListener("resize", updateCoords);
    };
  }, [isOpen, align]);

  // Filter options based on search term
  const filteredOptions = useMemo(() => {
    if (!searchTerm.trim()) return options;
    const term = searchTerm.toLowerCase();
    return options.filter(([opt]) => opt.toLowerCase().includes(term));
  }, [options, searchTerm]);

  // Handle option select
  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
    setSearchTerm("");
  };

  // Reset search and selection
  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
    setSearchTerm("");
  };

  return (
    <div className="min-w-[120px] max-w-[240px] shrink-0 relative" ref={containerRef}>
      <div className="relative">
        {/* Trigger Button */}
        <button
          ref={buttonRef}
          type="button"
          onClick={() => {
            setIsOpen(!isOpen);
            setSearchTerm("");
          }}
          className={`w-full flex items-center justify-between pl-3 pr-2 py-2 bg-slate-50 hover:bg-slate-100/70 border border-slate-200 rounded-xl text-xs transition-all text-left cursor-pointer focus:outline-none focus:ring-2 focus:ring-flu-grena/20 focus:border-flu-grena ${
            isOpen ? "border-flu-grena ring-2 ring-flu-grena/20" : ""
          }`}
        >
          <div className="flex items-center gap-1.5 truncate mr-2">
            {value ? (
              <>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider shrink-0 flex items-center gap-1 select-none">
                  {icon}
                  {label}:
                </span>
                <span className="truncate font-bold text-slate-700">
                  {value}
                </span>
              </>
            ) : (
              <span className="truncate font-bold text-slate-600 flex items-center gap-1.5">
                {icon}
                {label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {value && (
              <span
                onClick={handleClear}
                className="p-0.5 hover:bg-slate-200 rounded-full transition-colors"
                title="Limpar filtro"
              >
                <X size={12} className="text-slate-400 hover:text-slate-600" />
              </span>
            )}
            <ChevronDown
              size={14}
              className={`text-slate-400 transition-transform duration-200 ${isOpen ? "rotate-180 text-flu-grena" : ""}`}
            />
          </div>
        </button>

        {/* Dropdown Menu via Portal to escape parent overflows */}
        {isOpen && coords && createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: "absolute",
              top: `${coords.top}px`,
              left: `${coords.left}px`,
            }}
            className="z-[9999] mt-1.5 bg-white border border-slate-150 rounded-2xl shadow-[0_10px_30px_rgba(0,0,0,0.15)] overflow-hidden flex flex-col w-64 max-h-64 animate-fade-in"
          >
            {/* Search Input Box */}
            <div className="p-2 border-b border-slate-100 flex items-center gap-1.5 bg-slate-50/50 sticky top-0 shrink-0">
              <Search size={13} className="text-slate-400 ml-1.5 shrink-0" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Digitar para buscar..."
                className="w-full bg-transparent border-0 text-xs font-bold text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-0 py-1"
                autoFocus
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm("")}
                  className="p-1 hover:bg-slate-200 rounded-full transition-colors"
                >
                  <X size={11} className="text-slate-400" />
                </button>
              )}
            </div>

            {/* Options List */}
            <div className="overflow-y-auto divide-y divide-slate-50/60 max-h-48 shrink flex-1">
              {/* Option "TODOS" */}
              {!searchTerm && (
                <div
                  onClick={() => handleSelect("")}
                  className={`flex items-center justify-between px-3.5 py-2.5 text-xs font-bold cursor-pointer transition-colors ${
                    !value ? "bg-emerald-50/50 text-flu-verde" : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <span className="uppercase">TODOS</span>
                  {!value && <Check size={13} className="text-flu-verde shrink-0" />}
                </div>
              )}

              {/* Filtered Custom Options */}
              {filteredOptions.length > 0 ? (
                filteredOptions.map(([opt]) => {
                  const isSelected = value === opt;
                  return (
                    <div
                      key={opt}
                      onClick={() => handleSelect(opt)}
                      className={`flex items-center justify-between px-3.5 py-2.5 text-xs font-bold cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-emerald-50/50 text-flu-verde"
                          : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <span className="truncate pr-4">{opt}</span>
                      {isSelected && <Check size={13} className="text-flu-verde shrink-0" />}
                    </div>
                  );
                })
              ) : (
                <div className="px-4 py-4 text-center text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Nenhum resultado
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
      </div>
    </div>
  );
}
