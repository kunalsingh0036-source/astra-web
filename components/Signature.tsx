import styles from "./Signature.module.css";
import { HomeLink } from "@/components/HomeLink";

/**
 * The astra signature.
 *
 * Fixed bottom-left on every screen at 24px italic serif.
 * Like a handwritten signature on a letter — present, quiet, personal.
 * Clicking it returns you to the home canvas with the conversation
 * reset (see HomeLink).
 */
export function Signature() {
  return <HomeLink className={styles.signature} />;
}
