import { useTranslations } from "next-intl";
import { DEFAULT_BRAND_NAME } from "@/lib/brand-defaults";
import type { Brand as BrandSettings } from "@/lib/brand";
import { withBasePath } from "@/lib/base-path";
import styles from "./brand.module.css";

// The top left of the sidebars (lib/brand.ts): the site's name in Newsreader
// 600, or its SVG logo (named for screen readers by the site's name). Once
// changed from the default, "powered by KNOWLECTIVE" goes under it.
export function Brand({ brand, suffix }: { brand: BrandSettings; suffix?: string }) {
  const t = useTranslations("common");
  const customized = brand.mode === "IMAGE" || brand.name !== DEFAULT_BRAND_NAME;
  return (
    <div className={styles.brand} data-ui="Brand">
      <div className={styles.row}>
      {brand.mode === "IMAGE" && brand.logoVersion ? (
        // eslint-disable-next-line @next/next/no-img-element -- an SVG served as is (no optimizing)
        <img
          src={withBasePath(`/api/brand-logo?v=${brand.logoVersion}`)}
          alt={brand.name}
          className={styles.logo}
          data-ui="Brand.logo"
        />
      ) : (
        <span className={styles.name} data-ui="Brand.name">
          {brand.name}
        </span>
      )}
      {suffix && <span className={styles.suffix}>{suffix}</span>}
      </div>
      {customized && (
        <span className={styles.poweredBy} data-ui="Brand.poweredBy">
          {t("poweredBy")}
        </span>
      )}
    </div>
  );
}
