window.inkviaToolbar.onState(({ platform, theme }) => {
  document.documentElement.dataset.platform = platform;
  document.documentElement.dataset.theme = theme;
});
