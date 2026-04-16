import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { FileDrop } from "@/components/upload/FileDrop";
import { ColumnMapper } from "@/components/upload/ColumnMapper";
import { DatasetPreview } from "@/components/upload/DatasetPreview";
import { Button } from "@/components/ui/button";
import { api, UploadResponse } from "@/lib/backendApi";
import { toast } from "sonner";

export default function UploadPage() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<UploadResponse | null>(null);
  const [textCol, setTextCol] = useState("");
  const [langCol, setLangCol] = useState("");
  const [idCol, setIdCol] = useState("");
  const [running, setRunning] = useState(false);

  const handleFile = async (f: File) => {
    setFile(f);
    setLoading(true);
    setData(null);
    try {
      const res = await api.upload(f);
      setData(res);
      setTextCol(res.columns.find((c) => /text|name|title|desc/i.test(c)) ?? res.columns[0] ?? "");
      setLangCol(res.columns.find((c) => /lang/i.test(c)) ?? "");
      setIdCol(res.columns.find((c) => /^id$/i.test(c)) ?? "");
      toast.success(`Loaded ${res.row_count.toLocaleString()} rows`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  const handleRun = async () => {
    if (!data) return;
    setRunning(true);
    const threshold = 0.76;
    try {
      await api.run({
        job_id: data.job_id,
        text_column: textCol,
        language_column: langCol || undefined,
        id_column: idCol || undefined,
        threshold,
      });
      navigate(`/processing?job=${encodeURIComponent(data.job_id)}&threshold=${threshold.toFixed(2)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start pipeline");
      setRunning(false);
    }
  };

  return (
    <AppShell subtitle="Upload dataset">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border/70 bg-surface px-3 py-1 text-xs text-subtle">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Multilingual duplicate detection
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Find duplicates across any language.</h1>
          <p className="mt-2 max-w-xl text-sm text-subtle">
            Upload a CSV. We embed every record with cross-lingual models, cluster the matches,
            and let an LLM arbiter resolve the grey zone.
          </p>
        </motion.div>

        <div className="space-y-6">
          <FileDrop onFile={handleFile} loading={loading} fileName={file?.name} />

          {data && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <ColumnMapper
                columns={data.columns}
                textColumn={textCol}
                languageColumn={langCol}
                idColumn={idCol}
                onChange={(n) => {
                  setTextCol(n.textColumn);
                  setLangCol(n.languageColumn);
                  setIdCol(n.idColumn);
                }}
              />
              <DatasetPreview columns={data.columns} rows={data.preview} highlight={textCol} />

              <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-surface p-4">
                <div className="text-sm text-subtle">
                  <span className="font-mono text-foreground">{data.row_count.toLocaleString()}</span> rows ready ·
                  job <span className="font-mono">{data.job_id}</span>
                </div>
                <Button
                  onClick={handleRun}
                  disabled={!textCol || running}
                  className="gap-2 bg-gradient-primary text-primary-foreground shadow-glow hover:opacity-95"
                >
                  Run pipeline
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
