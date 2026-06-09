const STORAGE_BASE = 'https://rollingai-service-oss.oss-cn-beijing.aliyuncs.com';
const IMAGES = Array.from({ length: 9 }, (_, i) =>
  `${STORAGE_BASE}/myjadviser/assets/cases/case-${i + 1}.png`
);

/**
 * 3x3 grid of success cases that seamlessly scrolls top-to-bottom.
 * Renders the grid twice stacked so the animation loops without seams.
 */
const SuccessCasesGrid = () => {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <style>{`
        @keyframes case-scroll-down {
          0% { transform: translateY(-50%); }
          100% { transform: translateY(0%); }
        }
      `}</style>
      <div
        className="w-full"
        style={{
          animation: "case-scroll-down 120s linear infinite",
        }}
      >
        {[0, 1].map((loop) => (
          <div key={loop} className="flex flex-col gap-2 p-2">
            {IMAGES.map((src, i) => (
              <img
                key={`${loop}-${i}`}
                src={src}
                alt=""
                className="w-full h-auto object-contain block"
                draggable={false}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export default SuccessCasesGrid;
