import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { FileDrop } from "@/components/upload/FileDrop";
import { ColumnMapper } from "@/components/upload/ColumnMapper";
import { DatasetPreview } from "@/components/upload/DatasetPreview";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, DomainConfig, UploadResponse } from "@/lib/backendApi";
import { toast } from "sonner";

const DISPLAY_TO_BACKEND_DOMAIN: Record<string, string> = {
  "E-commerce / Products": "E-commerce Products",
  "Company Names": "Company Names",
  "Person Names": "Person Names",
  "Medical Records": "Medical Records",
  Others: "Others",
};

const DOMAIN_INFO: Record<string, string> = {
  "E-commerce / Products":
    "Strict threshold 0.82 — product variants like iPhone 15 vs iPhone 15 Pro will not be merged.",
  "Company Names":
    "Lenient threshold 0.74 — legal suffix variations like LLC vs Corporation will be merged.",
  "Person Names":
    "Balanced threshold 0.79 — name spelling variations like Mohammed vs Muhammad will be merged.",
  "Medical Records":
    "Very strict threshold 0.91 — conservative to avoid dangerous false positives.",
  Others:
    "Default threshold 0.82 — same as E-commerce. Adjust using the threshold slider after processing.",
};

const DOMAIN_OPTIONS = [
  "E-commerce / Products",
  "Company Names",
  "Person Names",
  "Medical Records",
  "Others",
] as const;

export default function UploadPage() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<UploadResponse | null>(null);
  const [textCol, setTextCol] = useState("");
  const [langCol, setLangCol] = useState("");
  const [idCol, setIdCol] = useState("");
  const [running, setRunning] = useState(false);
  const [domainsLoading, setDomainsLoading] = useState(true);
  const [domainConfigs, setDomainConfigs] = useState<Record<string, DomainConfig>>({});
  const [selectedDomain, setSelectedDomain] = useState<(typeof DOMAIN_OPTIONS)[number]>("E-commerce / Products");

  useEffect(() => {
    let alive = true;

    api
      .domains()
      .then((response) => {
        if (!alive) return;
        setDomainConfigs(response.configs);

        if (response.default === "Company Names") setSelectedDomain("Company Names");
        else if (response.default === "Person Names") setSelectedDomain("Person Names");
        else if (response.default === "Medical Records") setSelectedDomain("Medical Records");
        else setSelectedDomain("E-commerce / Products");
      })
      .catch((error) => {
        if (!alive) return;
        toast.error(error instanceof Error ? error.message : "Failed to load domain presets");
      })
      .finally(() => {
        if (alive) setDomainsLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

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
    const backendDomain = DISPLAY_TO_BACKEND_DOMAIN[selectedDomain];
    try {
      await api.run({
        job_id: data.job_id,
        text_column: textCol,
        language_column: langCol || undefined,
        id_column: idCol || undefined,
        domain: backendDomain,
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
          <div className="rounded-2xl border border-border/60 bg-surface p-5">
            <div className="space-y-3">
              <div>
                <div className="text-sm font-semibold">Choose a matching domain</div>
                <p className="mt-1 text-sm text-subtle">
                  This preset tunes thresholding and score weights before you upload.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
                  Domain
                </label>
                <Select
                  value={selectedDomain}
                  onValueChange={(value) => setSelectedDomain(value as (typeof DOMAIN_OPTIONS)[number])}
                  disabled={domainsLoading}
                >
                  <SelectTrigger className="border-border/70 bg-background/40">
                    <SelectValue placeholder="Select a domain" />
                  </SelectTrigger>
                  <SelectContent>
                    {DOMAIN_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
                <div className="font-medium text-foreground">
                  {DOMAIN_INFO[selectedDomain]}
                </div>
                <div className="mt-2 text-xs text-subtle">
                  Backend threshold preset:{" "}
                  <span className="font-mono text-foreground">
                    {(domainConfigs[DISPLAY_TO_BACKEND_DOMAIN[selectedDomain] === "Others" ? "E-commerce Products" : DISPLAY_TO_BACKEND_DOMAIN[selectedDomain]]?.threshold ?? 0.82).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>

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
