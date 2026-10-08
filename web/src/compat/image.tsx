import type { CSSProperties } from "react";

type Src = string | { src: string };

type Props = {
  src: Src;
  alt?: string;
  width?: number | string;
  height?: number | string;
  className?: string;
  fill?: boolean;
  priority?: boolean;
  quality?: number;
  sizes?: string;
  style?: CSSProperties;
  unoptimized?: boolean;
  loading?: "eager" | "lazy";
};

export default function Image({ src, alt = "", width, height, className, fill, style, loading }: Props) {
  const url = typeof src === "string" ? src : src.src;
  const filled: CSSProperties | undefined = fill
    ? { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }
    : undefined;
  return <img src={url} alt={alt} width={width} height={height} className={className} loading={loading} style={{ ...filled, ...style }} />;
}
