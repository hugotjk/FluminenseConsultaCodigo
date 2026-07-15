import React, { useState, useRef } from "react";
import { ImageConfig } from "../types";
import { X, Save, Settings, HelpCircle, AlertCircle, Database, Image, UploadCloud, RefreshCw, CheckCircle2 } from "lucide-react";

interface ImageConfigModalProps {
  currentConfig: ImageConfig;
  onSave: (config: ImageConfig) => Promise<void>;
  onClose: () => void;
  onImportLocalFile: (arrayBuffer: ArrayBuffer, fileName: string, isManual?: boolean) => Promise<boolean>;
  isSyncing: boolean;
  onTriggerCloudSync: () => Promise<void>;
}

type TabType = "images" | "database";

export default function ImageConfigModal({
  currentConfig,
  onSave,
  onClose,
  onImportLocalFile,
  isSyncing,
  onTriggerCloudSync,
}: ImageConfigModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>("images");
  
  // Image Config States
  const [baseUrl, setBaseUrl] = useState(currentConfig.baseUrl);
  const [matchField, setMatchField] = useState<"referencia" | "referencia_fornecedor" | "ean">(
    currentConfig.matchField
  );
  const [extension, setExtension] = useState<"jpg" | "png" | "jpeg" | "webp">(currentConfig.extension);
  
  // Database Config States
  const [spreadsheetId, setSpreadsheetId] = useState(
    currentConfig.spreadsheetId || "1oTpB5GtJ6WwEnlhF2LhBcuH5lvw9c7_u"
  );
  
  // Status States
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localImportStatus, setLocalImportStatus] = useState<{
    state: "idle" | "loading" | "success" | "error";
    message?: string;
  }>({ state: "idle" });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleSaveAll = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      await onSave({
        baseUrl: baseUrl.trim(),
        matchField,
        extension,
        spreadsheetId: spreadsheetId.trim(),
      });
      // Clear states if saved from "images" tab, or keep modal open if the user wants to keep configuring
      if (activeTab === "images") {
        onClose();
      } else {
        // Success indicator
        setLocalImportStatus({
          state: "success",
          message: "Configurações da planilha salvas com sucesso!",
        });
        setTimeout(() => setLocalImportStatus({ state: "idle" }), 3000);
      }
    } catch (err: any) {
      console.error(err);
      setError("Falha ao salvar as configurações no servidor.");
    } finally {
      setIsSaving(false);
    }
  };

  // Drag and drop handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      await processUploadedFile(file);
    }
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      await processUploadedFile(file);
    }
  };

  const processUploadedFile = async (file: File) => {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension !== "xlsx" && extension !== "xls") {
      setLocalImportStatus({
        state: "error",
        message: "Por favor, selecione apenas arquivos Excel (.xlsx ou .xls)",
      });
      return;
    }

    setLocalImportStatus({
      state: "loading",
      message: "Processando planilha local e atualizando banco de dados...",
    });

    try {
      const arrayBuffer = await file.arrayBuffer();
      const success = await onImportLocalFile(arrayBuffer, file.name);
      if (success) {
        setLocalImportStatus({
          state: "success",
          message: `Planilha "${file.name}" importada com sucesso! Todos os dispositivos usarão esta base agora.`,
        });
      } else {
        setLocalImportStatus({
          state: "error",
          message: "O processamento local falhou. Verifique se o formato da planilha está correto.",
        });
      }
    } catch (err: any) {
      console.error(err);
      setLocalImportStatus({
        state: "error",
        message: err.message || "Falha na leitura do arquivo Excel.",
      });
    }
  };

  return (
    <div 
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-backdrop-in cursor-pointer"
    >
      <div
        id="image-config-modal"
        className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-lg w-full overflow-hidden flex flex-col relative animate-fade-in cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Fluminense colored header stripe */}
        <div className="h-2.5 w-full flex flex-row shrink-0">
          <div className="flex-1 bg-flu-grena" />
          <div className="flex-1 bg-white" />
          <div className="flex-1 bg-flu-verde" />
        </div>

        {/* Modal Header */}
        <div className="p-6 pb-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Settings className="text-flu-grena animate-spin-slow" size={22} />
            <h2 className="font-sans font-black text-slate-800 text-lg uppercase tracking-wider">
              Painel de Configurações
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-all duration-200"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 pt-3 flex border-b border-slate-100 shrink-0 gap-4 bg-slate-50/50">
          <button
            onClick={() => setActiveTab("images")}
            className={`pb-3 text-xs font-bold uppercase tracking-wider flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
              activeTab === "images"
                ? "border-flu-grena text-flu-grena font-extrabold"
                : "border-transparent text-slate-400 hover:text-slate-600"
            }`}
          >
            <Image size={15} />
            Imagens dos Produtos
          </button>
          <button
            onClick={() => setActiveTab("database")}
            className={`pb-3 text-xs font-bold uppercase tracking-wider flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
              activeTab === "database"
                ? "border-flu-grena text-flu-grena font-extrabold"
                : "border-transparent text-slate-400 hover:text-slate-600"
            }`}
          >
            <Database size={15} />
            Base de Dados / Planilha
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 overflow-y-auto max-h-[70vh] space-y-5">
          {error && (
            <div className="bg-rose-50 text-rose-600 text-xs font-semibold p-3.5 rounded-xl border border-rose-100 flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {activeTab === "images" ? (
            /* TAB 1: IMAGES CONFIG */
            <form onSubmit={handleSaveAll} className="space-y-5">
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
                    Vincular Imagem por:
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
                    Extensão da Imagem
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
                    <span className="text-slate-400 italic">URL de fotos não definida (mostrará imagem padrão)</span>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 font-bold text-xs rounded-xl transition-all duration-200 uppercase tracking-wider text-center cursor-pointer"
                >
                  Fechar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 py-2.5 bg-flu-grena hover:bg-red-950 text-white font-bold text-xs rounded-xl transition-all duration-200 uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Save size={14} />
                  {isSaving ? "Salvando..." : "Salvar Configuração"}
                </button>
              </div>
            </form>
          ) : (
            /* TAB 2: DATABASE / SPREADSHEET CONFIG */
            <div className="space-y-6">
              {/* Cloud Spreadsheet Section */}
              <div className="space-y-3">
                <div className="flex items-center gap-1.5">
                  <Database size={16} className="text-flu-grena" />
                  <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider">
                    Sincronização em Nuvem (Google Drive)
                  </h3>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
                    ID da Planilha no Google Drive
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Ex: 1oTpB5GtJ6WwEnlhF2LhBcuH5lvw9c7_u"
                      value={spreadsheetId}
                      onChange={(e) => setSpreadsheetId(e.target.value)}
                      className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 text-sm focus:outline-none focus:border-flu-grena focus:ring-1 focus:ring-flu-grena transition-all font-mono"
                    />
                    <button
                      onClick={() => handleSaveAll()}
                      disabled={isSaving}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-1 cursor-pointer"
                      title="Salvar ID da planilha"
                    >
                      <Save size={14} />
                      Salvar ID
                    </button>
                  </div>
                  <span className="text-[10px] font-semibold text-slate-400 block pt-0.5">
                    Este ID define a origem de dados padrão para as atualizações em nuvem.
                  </span>
                </div>

                <div className="pt-2">
                  <button
                    onClick={onTriggerCloudSync}
                    disabled={isSyncing}
                    className="w-full py-2.5 bg-flu-verde hover:bg-emerald-950 text-white font-bold text-xs rounded-xl transition-all duration-200 uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 cursor-pointer"
                  >
                    <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />
                    {isSyncing ? "Sincronizando Nuvem..." : "Sincronizar via Google Drive agora"}
                  </button>
                </div>
              </div>

              {/* Local Drag & Drop Upload Section */}
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <UploadCloud size={16} className="text-flu-grena" />
                    <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider">
                      Importação Direta Local (Excel)
                    </h3>
                  </div>
                  <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-lg px-2 py-0.5 font-bold text-[9px] uppercase tracking-wider">
                    Livre de Erros de Proxy
                  </span>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed font-medium">
                  Se a sincronização em nuvem falhar com <strong className="text-rose-500">Erro de Proxy</strong> (geralmente por conta de instabilidade de rede ou tamanho da planilha), arraste ou selecione o arquivo <strong className="font-semibold text-slate-600">.xlsx</strong> diretamente do seu computador!
                </p>

                {/* Drag and Drop Zone */}
                <div
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-200 min-h-[140px] ${
                    dragActive
                      ? "border-flu-grena bg-flu-grena/5 text-flu-grenaScale"
                      : "border-slate-200 hover:border-flu-grena hover:bg-slate-50/50 text-slate-400"
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={handleFileInput}
                  />
                  <UploadCloud size={32} className={`mb-2 transition-transform duration-200 ${dragActive ? "scale-110 text-flu-grena" : "text-slate-400"}`} />
                  <span className="text-xs font-extrabold text-slate-600 uppercase tracking-wider block">
                    Arrastar arquivo Excel (.xlsx) aqui
                  </span>
                  <span className="text-[10px] font-bold text-slate-400 mt-1">
                    ou clique para procurar no seu dispositivo
                  </span>
                </div>

                {/* Import Status Indicator */}
                {localImportStatus.state !== "idle" && (
                  <div
                    className={`p-3.5 rounded-xl border flex items-center gap-2.5 transition-all animate-fade-in ${
                      localImportStatus.state === "loading"
                        ? "bg-amber-50 text-amber-700 border-amber-100 text-xs font-bold"
                        : localImportStatus.state === "success"
                        ? "bg-emerald-50 text-emerald-800 border-emerald-200 text-xs font-extrabold"
                        : "bg-rose-50 text-rose-600 border-rose-200 text-xs font-bold"
                    }`}
                  >
                    {localImportStatus.state === "loading" && (
                      <RefreshCw size={14} className="animate-spin shrink-0 text-amber-500" />
                    )}
                    {localImportStatus.state === "success" && (
                      <CheckCircle2 size={16} className="shrink-0 text-emerald-500" />
                    )}
                    {localImportStatus.state === "error" && (
                      <AlertCircle size={15} className="shrink-0 text-rose-500" />
                    )}
                    <span className="leading-snug">{localImportStatus.message}</span>
                  </div>
                )}
              </div>

              {/* Close Button */}
              <div className="pt-4 flex gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 font-bold text-xs rounded-xl transition-all duration-200 uppercase tracking-wider text-center cursor-pointer"
                >
                  Fechar Configurações
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
