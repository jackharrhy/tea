const styles = getComputedStyle(document.documentElement);
for (const value of document.querySelectorAll("[data-token-value]")) {
  value.textContent = styles.getPropertyValue(value.dataset.tokenValue).trim();
}
