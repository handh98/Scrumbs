// src/renderer/js/router.js

window.navigate = async function (pageId) {
  const renderContainer = $("page-render");

  window.loadCSS(`${pageId}.css`);

  try {
    // 2. Fetch giao diện HTML nạp vào container
    const response = await fetch(`./src/renderer/pages/${pageId}.html`);
    if (!response.ok) throw new Error(`Không tìm thấy file: ${pageId}.html`);
    const html = await response.text();
    renderContainer.innerHTML = html;
    updateMenuActive(pageId);

    const scriptId = `script-${pageId}`;

    // Optimized: Only load the script if the logic isn't already available
    if (!$(scriptId)) {
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = `./src/renderer/js/${pageId}.js`; // Removed cache buster for production performance
      script.onload = () => {
        initPageLogic(pageId);
      };
      document.body.appendChild(script);
    } else {
      // If script is already loaded, just trigger the init function
      initPageLogic(pageId);
    }
  } catch (err) {
    console.error(err);
    renderContainer.innerHTML = `<div style="color:red; padding:20px;">Lỗi tải trang: ${err.message}</div>`;
  }
};

function initPageLogic(pageId) {
  const functionName = `load${pageId.charAt(0).toUpperCase() + pageId.slice(1)}`;

  if (typeof window[functionName] === "function") {
    window[functionName](1);
    console.log(`Đã kích hoạt hàm khởi tạo tự động: ${functionName}()`);
  } else {
    console.warn(
      `Không tìm thấy hàm khởi tạo ${functionName}() công khai cho trang này.`,
    );
  }
}

// Hàm bổ trợ để active menu
function updateMenuActive(pageId) {
  $$(".nav-btn").forEach((btn) => {
    btn.classList.remove("active");
    if (
      btn.getAttribute("onclick") &&
      btn.getAttribute("onclick").includes(`'${pageId}'`)
    ) {
      btn.classList.add("active");
    }
  });
}
