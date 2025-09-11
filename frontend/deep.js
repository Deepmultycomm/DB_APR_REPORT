function formatCustomTimestamp(timestamp) {
  if (!timestamp) return "";

  let unixMs;

  // Detect and normalize
  if (timestamp.toString().length === 11) {
    unixMs = Math.floor(timestamp / 100) * 1000; // centiseconds → ms
  } else if (timestamp.toString().length === 13) {
    unixMs = Number(timestamp); // already ms
  } else if (timestamp.toString().length === 10) {
    unixMs = Number(timestamp) * 1000; // seconds → ms
  } else {
    return "Invalid timestamp";
  }

  // Convert to Dubai time
  const dubaiString = new Date(unixMs).toLocaleString("en-US", {
    timeZone: "Asia/Dubai",
  });
  const dubaiDate = new Date(dubaiString);

  // Format as YYYY-MM-DDTHH:mm
  const yyyy = dubaiDate.getFullYear();
  const mm = String(dubaiDate.getMonth() + 1).padStart(2, "0");
  const dd = String(dubaiDate.getDate()).padStart(2, "0");
  const hh = String(dubaiDate.getHours()).padStart(2, "0");
  const min = String(dubaiDate.getMinutes()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}







var x=formatCustomTimestamp(1755418904); 
console.log("x=====",x)

function convertToUnixDubai(dateString) {
  if (!dateString) return "";

  // Parse the input (YYYY-MM-DDTHH:mm)
  const [datePart, timePart] = dateString.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);

  // Create a UTC date object from parsed values
  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute));

  // Convert to Dubai local time string
  const dubaiString = utcDate.toLocaleString("en-US", { timeZone: "Asia/Dubai" });

  // Recreate a Date object in Dubai’s local time
  const dubaiDate = new Date(dubaiString);

  // Return UNIX timestamp (seconds)
  return Math.floor(dubaiDate.getTime() / 1000);
}



function dubaiDateTimeToUnix(dateTimeStr) {
  if (!dateTimeStr) return "";

  // Parse components (YYYY-MM-DDTHH:mm:ss.sss)
  const [datePart, timePart] = dateTimeStr.split("T");
  const [year, month, day] = datePart.split("-").map(Number);

  const [timeMain, msPart = "0"] = timePart.split(".");
  const [hour, minute, second] = timeMain.split(":").map(Number);

  const ms = Number(msPart);

  // Build date in Dubai timezone
  const dubaiDate = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second, ms)
  );

  // Shift to Dubai timezone
  const dubaiString = dubaiDate.toLocaleString("en-US", {
    timeZone: "Asia/Dubai",
  });
  const adjusted = new Date(dubaiString);

  // Return as float seconds (with ms precision)
  return adjusted.getTime() / 1000;
}
console.log("----------------------------",dubaiDateTimeToUnix("2025-09-15T18:53:59.969"));










// console.log(convertToUnixDubai(x))
console.log(x)