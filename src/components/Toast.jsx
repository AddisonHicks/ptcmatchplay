export function Toast({ message }) {
  if (!message) return null;
  return <div className="mp-toast">✓ {message}</div>;
}
