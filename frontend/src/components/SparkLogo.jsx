export default function SparkLogo({
  size = 28,
  className = "",
  alt = "Spark",
}) {
  return (
    <img
      src="/spark.svg"
      width={size}
      height={size}
      alt={alt}
      className={className}
      draggable={false}
    />
  );
}
