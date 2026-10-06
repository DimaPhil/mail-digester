export default function Loading() {
  return (
    <main
      className="reading-content"
      aria-busy="true"
      aria-label="Loading your library"
    >
      <div className="eyebrow">MAIL DIGESTER</div>
      <h1>Your reading space.</h1>
      <p className="muted">Loading your library…</p>
    </main>
  );
}
