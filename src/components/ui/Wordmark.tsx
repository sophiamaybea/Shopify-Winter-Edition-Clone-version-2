export function Wordmark({ size = "sm" }: { size?: "sm" | "lg" }) {
  const big = size === "lg";
  return (
    <p
      className={`font-sans leading-[0.95] font-bold ${
        big ? "text-4xl sm:text-5xl" : "text-lg"
      }`}
    >
      The
      <br />
      Writing
      <br />
      School
    </p>
  );
}
