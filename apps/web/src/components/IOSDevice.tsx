import { type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

/**
 * iPhone-style device frame. On desktop renders as a centered phone mock;
 * on small viewports (<= 480px) it expands to fill the screen seamlessly.
 */
export function IOSDevice({ children }: Props) {
  return (
    <div className="min-h-screen w-full bg-canvas flex items-start sm:items-center justify-center sm:py-10">
      <div
        className="
          relative bg-surface overflow-hidden shadow-none
          w-full min-h-screen
          sm:w-[390px] sm:min-h-0 sm:h-[844px] sm:rounded-[55px]
          sm:shadow-[0_30px_80px_-20px_rgba(0,0,0,0.35),0_10px_30px_-10px_rgba(0,0,0,0.2)]
          sm:border sm:border-black/10
        "
      >
        {/* Content */}
        <div className="relative h-full overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
