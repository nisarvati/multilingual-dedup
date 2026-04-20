// components/results/ArbiterLog.tsx

interface ArbiterDecision {
  text_a: string
  text_b: string
  similarity_score: number
  is_duplicate: boolean
  confidence: number
  reasoning: string
  abstained: boolean
}

interface Props {
  decisions: ArbiterDecision[]
}

export function ArbiterLog({ decisions }: Props) {
  if (!decisions || decisions.length === 0) {
    return (
      <div className="text-sm text-gray-500 italic p-4">
        No grey zone pairs found — all decisions were made by the embedding model.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500 text-xs uppercase">
            <th className="pb-2 pr-4">Record A</th>
            <th className="pb-2 pr-4">Record B</th>
            <th className="pb-2 pr-4">Score</th>
            <th className="pb-2 pr-4">Verdict</th>
            <th className="pb-2 pr-4">Confidence</th>
            <th className="pb-2">Reasoning</th>
          </tr>
        </thead>
        <tbody>
          {decisions.map((d, i) => (
            <tr key={i} className={`border-b last:border-0 ${
              d.abstained ? "opacity-50" : ""
            }`}>
              <td className="py-3 pr-4 max-w-[180px] truncate font-mono text-xs">
                {d.text_a}
              </td>
              <td className="py-3 pr-4 max-w-[180px] truncate font-mono text-xs">
                {d.text_b}
              </td>
              <td className="py-3 pr-4 text-gray-600">
                {d.similarity_score.toFixed(3)}
              </td>
              <td className="py-3 pr-4">
                {d.abstained ? (
                  <span className="text-gray-400">Abstained</span>
                ) : d.is_duplicate ? (
                  <span className="text-green-600 font-medium">Duplicate</span>
                ) : (
                  <span className="text-red-500 font-medium">Different</span>
                )}
              </td>
              <td className="py-3 pr-4">
                <div className="flex items-center gap-2">
                  <div className="w-16 h-1.5 bg-gray-200 rounded-full">
                    <div
                      className="h-1.5 rounded-full bg-blue-500"
                      style={{ width: `${d.confidence * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500">
                    {Math.round(d.confidence * 100)}%
                  </span>
                </div>
              </td>
              <td className="py-3 text-gray-600 text-xs italic max-w-[200px]">
                {d.reasoning}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}