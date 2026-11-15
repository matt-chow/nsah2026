/** The Sky Flipbook three.js scene, unchanged, filling the space below the site nav. */
export function FlipbookPage() {
  return (
    <iframe
      className="flipbook"
      src={`${import.meta.env.BASE_URL}flipbook/index.html`}
      title="SPHEREx Sky Flipbook: every SPHEREx image of a sky position, played in time order over a 3D landscape"
    />
  );
}
