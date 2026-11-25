import { redirect } from "next/navigation";

// The unit master now lives on /base-units (one list, one set of rules). This route stays so existing links and bookmarks keep working.
export default function UnitsRedirect() {
  redirect("/base-units");
}
