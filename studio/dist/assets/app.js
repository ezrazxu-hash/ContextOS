const route = window.location.pathname + window.location.search;
document.querySelector("[data-testid='route']").textContent = route;
fetch("/__contextos/config.json")
  .then((response) => response.json())
  .then((config) => {
    document.querySelector("[data-testid='api-base-url']").textContent = config.apiBaseUrl;
    document.querySelector("[data-testid='sse-base-url']").textContent = config.sseBaseUrl;
    document.querySelector("[data-testid='rehydrate-status']").textContent = "Ready";
  })
  .catch(() => {
    document.querySelector("[data-testid='rehydrate-status']").textContent = "Runtime config unavailable";
  });
