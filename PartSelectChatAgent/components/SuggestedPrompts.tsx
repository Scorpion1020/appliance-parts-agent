type SuggestedPromptsProps = {
  prompts: string[];
  onPromptClick: (prompt: string) => void;
};

export function SuggestedPrompts({ prompts, onPromptClick }: SuggestedPromptsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {prompts.map((prompt) => (
        <button
          key={prompt}
          type="button"
          onClick={() => onPromptClick(prompt)}
          className="rounded-lg border border-[#d1d5db] bg-[#f4f6f8] px-3 py-1.5 text-left text-xs font-medium text-[#374151] transition hover:border-[#3d5a73] hover:bg-[#dce6ee] hover:text-[#1f2937]"
        >
          {prompt}
        </button>
      ))}
    </div>
  );
}
