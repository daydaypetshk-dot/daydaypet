"use client";

export default function AppToast({
  message,
  tone = "error",
  onClose,
}: {
  message: string | null;
  tone?: "error" | "success";
  onClose: () => void;
}) {
  if (!message) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[1600] flex justify-center px-4">
      <div
        className={[
          "pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl px-4 py-3 shadow-2xl",
          tone === "success" ? "bg-emerald-600 text-white" : "bg-zinc-900 text-white",
        ].join(" ")}
      >
        <div className="text-sm font-black leading-relaxed">{message}</div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl bg-white/15 px-2 py-1 text-xs font-black text-white"
        >
          關閉
        </button>
      </div>
    </div>
  );
}

