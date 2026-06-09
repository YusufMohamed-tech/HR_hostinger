export function printHtmlReport(html: string, fallbackFilename: string) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const popup = window.open(url, "_blank", "width=1200,height=800");

  if (popup) {
    popup.focus();

    const printReport = () => {
      try {
        popup.focus();
        popup.print();
      } catch {
        // The report is already visible, so a failed automatic print call is non-fatal.
      }
    };

    popup.addEventListener("load", () => window.setTimeout(printReport, 250), { once: true });
    window.setTimeout(printReport, 900);
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);

    return true;
  }

  const link = document.createElement("a");
  link.href = url;
  link.download = fallbackFilename.endsWith(".html") ? fallbackFilename : `${fallbackFilename}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return false;
}
