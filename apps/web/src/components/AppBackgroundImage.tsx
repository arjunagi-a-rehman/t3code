import { useEffect } from "react";

import { useClientSettings } from "../hooks/useSettings";

export function AppBackgroundImage() {
  const backgroundImage = useClientSettings((settings) => settings.backgroundImage);
  const backgroundImageOpacity = useClientSettings((settings) => settings.backgroundImageOpacity);
  const hasBackgroundImage = backgroundImage !== null && backgroundImage.startsWith("data:image/");

  useEffect(() => {
    if (!hasBackgroundImage) return;
    document.documentElement.dataset.appBackgroundImage = "true";
    return () => {
      delete document.documentElement.dataset.appBackgroundImage;
    };
  }, [hasBackgroundImage]);

  if (!hasBackgroundImage) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <img
        src={backgroundImage}
        alt=""
        className="size-full object-cover object-center"
        style={{ opacity: backgroundImageOpacity }}
      />
    </div>
  );
}
