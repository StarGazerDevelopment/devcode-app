const url = "https://github.com/StarGazerDevelopment/devcode-app/raw/main/Installer/installer.exe";

console.log(`Testing fetch for: ${url}`);

try {
  // Using a HEAD request to only grab headers, not the entire 130MB+ file.
  const response = await fetch(url, { method: 'HEAD' });
  
  console.log(`\nStatus Code: ${response.status} ${response.statusText}`);
  
  if (response.ok) {
    console.log(`Success! The file is publicly accessible.`);
    
    // Convert bytes to MB for readable output
    const sizeBytes = parseInt(response.headers.get('content-length') || '0', 10);
    const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2);
    
    console.log(`Content-Length: ${sizeMB} MB`);
    console.log(`Content-Type: ${response.headers.get('content-type')}`);
    
  } else {
    console.error(`\nFailed to fetch the file.`);
    console.error(`If you get a 404, the repository "devcode-app" is likely set to PRIVATE.`);
  }
} catch (err) {
  console.error(`\nError fetching file: ${err.message}`);
}
