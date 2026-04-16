import { motion } from "framer-motion";

interface Token {
  token: string;
  weight: number;
}

const tokenStyle = (w: number): React.CSSProperties => {
  const alpha = Math.min(0.85, 0.1 + w * 0.7);
  return {
    backgroundColor: `hsl(217 91% 60% / ${alpha * 0.25})`,
    color: w > 0.6 ? "hsl(217 91% 80%)" : "hsl(220 13% 91%)",
    boxShadow: w > 0.7 ? `0 0 12px hsl(217 91% 60% / ${alpha * 0.6})` : undefined,
    borderColor: `hsl(217 91% 60% / ${alpha * 0.5})`,
  };
};

export const TokenAttribution = ({ tokens, label }: { tokens: Token[]; label: string }) => {
  return (
    <div>
      <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {tokens.map((t, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.02 }}
            style={tokenStyle(t.weight)}
            className="inline-flex items-center rounded-md border px-2 py-0.5 text-sm font-mono"
          >
            {t.token}
          </motion.span>
        ))}
      </div>
    </div>
  );
};
