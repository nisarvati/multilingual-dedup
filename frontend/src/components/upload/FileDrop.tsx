import { useCallback, useRef, useState } from "react";
import { motion } from "framer-motion";
import { UploadCloud, FileSpreadsheet, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  onFile: (f: File) => void;
  loading?: boolean;
  fileName?: string;
}

export const FileDrop = ({ onFile, loading, fileName }: Props) => {
  const [hover, setHover] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = useCallback(
    (f?: File | null) => {
      if (f) onFile(f);
    },
    [onFile]
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      onDragOver={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setHover(false);
        handle(e.dataTransfer.files?.[0]);
      }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "group relative cursor-pointer overflow-hidden rounded-2xl border border-dashed border-border bg-surface p-10 text-center transition-all",
        "hover:border-primary/50 hover:shadow-glow",
        hover && "border-primary shadow-glow"
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => handle(e.target.files?.[0])}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-glow opacity-60" />
      <div className="relative flex flex-col items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-primary shadow-glow">
          {loading ? (
            <Loader2 className="h-6 w-6 animate-spin text-primary-foreground" />
          ) : fileName ? (
            <FileSpreadsheet className="h-6 w-6 text-primary-foreground" />
          ) : (
            <UploadCloud className="h-6 w-6 text-primary-foreground" />
          )}
        </div>
        <div>
          <div className="text-base font-medium">
            {loading
              ? "Uploading & inspecting…"
              : fileName
              ? fileName
              : "Drop your CSV here, or click to browse"}
          </div>
          <div className="mt-1 text-sm text-subtle">
            We'll detect columns and language automatically · CSV up to 200MB
          </div>
        </div>
      </div>
    </motion.div>
  );
};
