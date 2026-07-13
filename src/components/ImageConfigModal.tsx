import React, { useState, useEffect } from "react";
import { ImageConfig } from "../types";
import { X, Save, Settings, HelpCircle, AlertCircle } from "lucide-react";

interface ImageConfigModalProps {
  currentConfig: ImageConfig;
  onSave: (config: ImageConfig) => Promise<void>;
  onClose: () => void;
}

export default function ImageConfigModal({ currentConfig, onSave, onClose }: ImageConfigModalProps) {
  const [baseUrl, setBaseUrl] = useState(currentConfig.baseUrl);
  const [matchField, setMatchField] = useState<"referencia" | "referencia_fornecedor" | "ean">(
    currentConfig.matchField
  );
  const [extension, setExtension] = useState<"jpg" | "png" | "jpeg" | "webp">(currentConfig.extension);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      await onSave({
        baseUrl: baseUrl.trim(),
        matchField,
        extension,
      });
      onClose();
    } catch (err: any) {
      console.error(err);
      setError("Falha ao salvar as configurações no servidor.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div
        id="image-config-modal"
        className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden flex flex-col relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Fluminense colored header stripe */}
        <div className="h-2 w-full flex flex-row">
          <div className="flex-1 bg-flu-grena" />
          <div className="flex-1 bg-flu-verde" />
        </div>

        {/* Modal Header */}
        <div className="p-6 pb-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="text-flu-grena" size={20} />
            <h2 className="font-sans font-black text-slate-800 text-lg uppercase tracking-wider">
              Configurar Imagens
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-all duration-200"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="bg-red-50 text-red-600 text-xs font-semibold p-3.5 rounded-xl border border-red-100 flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
              URL Base do Servidor de Fotos
            </label>
            <input
              type="url"
              required
              placeholder="Ex: https://fotos.meusite.com.br/produtos/"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 text-sm focus:outline-none focus:border-flu-grena focus:ring-1 focus:ring-flu-grena transition-all font-mono"
            />
            <span className="text-[10px] font-semibold text-slate-400 block pt-0.5">
              Insira o link do diretório onde as fotos estão hospedadas.
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                Nome do Arquivo correspondente a:
              </label>
              <select
                value={matchField}
                onChange={(e) => setMatchField(e.target.value as any)}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 text-sm focus:outline-none focus:border-flu-grena focus:ring-1 focus:ring-flu-grena transition-all font-semibold"
              >
                <option value="referencia">Referência (Ex: 64809)</option>
                <option value="referencia_fornecedor">Ref. Fornecedor (Ex: 78818801)</option>
                <option value="ean">EAN de Venda</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                Extensão do Arquivo
              </label>
              <select
                value={extension}
                onChange={(e) => setExtension(e.target.value as any)}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 text-sm focus:outline-none focus:border-flu-grena focus:ring-1 focus:ring-flu-grena transition-all font-semibold"
              >
                <option value="jpg">.jpg</option>
                <option value="png">.png</option>
                <option value="jpeg">.jpeg</option>
                <option value="webp">.webp</option>
              </select>
            </div>
          </div>

          {/* Example / Preview Box */}
          <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4 space-y-2">
            <div className="flex items-center gap-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              <HelpCircle size={12} />
              <span>Exemplo de Busca de Imagem</span>
            </div>
            <div className="text-xs font-mono text-slate-500 bg-white border border-slate-100 rounded-xl p-2.5 break-all">
              {baseUrl.trim() ? (
                <span>
                  {baseUrl.trim().endsWith("/") ? baseUrl.trim() : `${baseUrl.trim()}/`}
                  <strong className="text-flu-grena">
                    {matchField === "referencia"
                      ? "64809"
                      : matchField === "referencia_fornecedor"
                      ? "78818801"
                      : "7896480912345"}
                  </strong>
                  .{extension}
                </span>
              ) : (
                <span className="text-slate-400 italic">URL não informada (mostrará "Sem Foto")</span>
              )}
            </div>
          </div>

          {/* Save Button */}
          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 font-bold text-xs rounded-xl transition-all duration-200 uppercase tracking-wider text-center"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 py-2.5 bg-flu-grena hover:bg-red-950 text-white font-bold text-xs rounded-xl transition-all duration-200 uppercase tracking-wider flex items-center justify-center gap-1.5"
            >
              <Save size={14} />
              {isSaving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
