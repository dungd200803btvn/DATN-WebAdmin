const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

async function scrapeTiki(url) {
  let options = new chrome.Options();
  options.addArguments('headless'); // Chạy trình duyệt ở chế độ không giao diện
  let driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();

  try {
  
    await driver.get(url);

    await driver.wait(until.elementLocated(By.css('a[data-view-id="pdp_main_view_photo"]')), 10000);
    
    const aElements = await driver.findElements(By.css('a[data-view-id="pdp_main_view_photo"]'));

    let imageUrls = new Set(); // Dùng Set để tự động loại bỏ trùng lặp

    for (const aElement of aElements) {
      try {
        const imgElement = await aElement.findElement(By.css('img'));
        const imgSrc = await imgElement.getAttribute('src');
        if (imgSrc.includes("200x280")) { // Chỉ lấy ảnh 200x280
          imageUrls.add(imgSrc);
        }
      } catch (err) {}

      try {
        const sourceElement = await aElement.findElement(By.css('source'));
        const sourceSrcset = await sourceElement.getAttribute('srcset');
        const srcsetUrls = sourceSrcset.split(',').map(item => item.trim().split(' ')[0]);
        srcsetUrls.forEach(url => {
          if (url.includes("200x280")) { // Chỉ lấy ảnh 200x280
            imageUrls.add(url);
          }
        });
      } catch (err) {}
    }

    // Chuyển Set thành mảng, lấy đúng 8 ảnh đầu tiên
    const finalImageUrls = Array.from(imageUrls).slice(0, 8);

    console.log("Danh sách 8 URL ảnh:", finalImageUrls);
  } catch (err) {
    console.error("Lỗi:", err);
  } finally {
    await driver.quit();
  }
}

scrapeTiki('https://tiki.vn/hieu-ve-trai-tim-tai-ban-p42230121.html?spid=42230122&src=category-page-8322&2hi=0');
