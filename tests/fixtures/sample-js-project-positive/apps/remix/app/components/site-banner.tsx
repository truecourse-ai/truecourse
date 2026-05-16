// dangerouslySetInnerHTML with admin-only content — no unauthenticated write path, intentional rich-text banner
type BannerConfig = {
  enabled: boolean;
  data: { content: string; bgColor: string; textColor: string };
};

function SiteBanner({ banner }: { banner: BannerConfig }) {
  if (!banner.enabled) return null;

  return (
    <div style={{ background: banner.data.bgColor }}>
      <div
        className="mx-auto max-w-screen-xl px-4 py-3"
        style={{ color: banner.data.textColor }}
      >
        <span dangerouslySetInnerHTML={{ __html: banner.data.content }} />
      </div>
    </div>
  );
}
