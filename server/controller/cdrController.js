// controller/cdrController.js
import { Parser } from 'json2csv';
import { getReportData } from '../generateReport.js';
import { fetchAPRDataService, fetchAgentStatusDataService } from "../Collecetions/fetchAPIToMergeData.js";

// REFACTORED: This is now a simple controller that calls the service layer.
export const fetchAPRDataController = async (req, res) => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: "startDate and endDate are required" });
  }

  try {
    const data = await fetchAPRDataService(startDate, endDate);
    res.json(data);
  } catch (err) {
    console.error("Controller Error fetching APR data:", err.message);
    res.status(502).json({ error: "Upstream fetch failed", details: err.message });
  }
};

export const fetchAgentStatusDataController = async (req, res) => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: "startDate and endDate are required" });
  }

  try {
    const data = await fetchAgentStatusDataService(startDate, endDate);
    res.json(data);
  } catch (err) {
    console.error("Controller Error fetching Agent Status data:", err.message);
    res.status(502).json({ error: "Upstream fetch failed", details: err.message });
  }
};

// --- UPDATED CONTROLLER FOR GENERATING REPORTS ---

export const generateReportController = async (req, res) => {
    // --- MODIFIED: Get startTime and endTime from query ---
    let { startDate, endDate, startTime, endTime } = req.query;

    if (!startDate) {
        return res.status(400).json({ error: "startDate (YYYY-MM-DD) is required" });
    }
    
    // Default times if not provided
    startTime = startTime || '00:00:00';
    endTime = endTime || '00:00:00';

    // --- MODIFIED: Logic to construct full date-time strings ---
    const formattedStartDate = `${startDate} ${startTime}`;
    let formattedEndDate;
    let reportEndDate = endDate; // For filename

    if (endDate) {
        formattedEndDate = `${endDate} ${endTime}`;
    } else {
        // Default to a 24-hour report if no endDate is provided
        const nextDay = new Date(`${startDate}T${startTime}`);
        nextDay.setDate(nextDay.getDate() + 1);
        reportEndDate = nextDay.toISOString().slice(0, 10);
        formattedEndDate = `${reportEndDate} ${startTime}`;
    }

    try {
        const jsonData = await getReportData(formattedStartDate, formattedEndDate);

        if (!jsonData || jsonData.length === 0) {
            return res.status(404).json({ message: "No data found for the specified date range." });
        }

        const json2csvParser = new Parser();
        const csv = json2csvParser.parse(jsonData);

        const fileName = `report_${startDate}_to_${reportEndDate}.csv`;
        res.header('Content-Type', 'text/csv');
        res.attachment(fileName);
        return res.send(csv);

    } catch (err) {
        console.error("Controller Error generating report:", err.message);
        res.status(500).json({ error: "Failed to generate report", details: err.message });
    }
};