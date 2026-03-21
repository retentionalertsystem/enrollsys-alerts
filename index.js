// index.js
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config(); // must be called before accessing process.env

// Add this helper function for delay
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || "60000");

async function sendAlertEmail(alert) {
  try {
    const templateParams = {
      student_name: alert.student_name || "Student",
      student_email: alert.student_email,
      message: `This is to inform you that a retention alert has been created.

        Alert Details:
        
        Subject Code: ${alert.subject_code}
        Risk Level: ${alert.risk || "N/A"}
        Reason: ${alert.reason || "Failed grade"}
        Description: ${alert.description || "N/A"}
        Created At: ${alert.created_at ? new Date(alert.created_at).toLocaleString() : "N/A"}
        
        Please follow up according to the retention policy.`
    };

    const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // "Authorization": `Bearer ${process.env.EMAILJS_PRIVATE_KEY}` // Private Key here
      },
      body: JSON.stringify({
        service_id: process.env.EMAILJS_SERVICE_ID,
        template_id: process.env.EMAILJS_TEMPLATE_ID,
        user_id: process.env.EMAILJS_PUBLIC_KEY,
        template_params: templateParams
      })
    });

    const text = await res.text();

    if (res.ok) {
      console.log("Email sent successfully:", text);
    } else {
      console.error("Email failed:", text);
    }

  } catch (err) {
    console.error("Email sending failed:", err);
  }
}

async function generateAlerts() {
console.log("API URL:", process.env.ENROLLSYS_API);
console.log("API Key:", process.env.ENROLLSYS_API_KEY?.slice(0, 5) + "..."); // partial for safety
console.log("Private Key loaded?", !!process.env.EMAILJS_PRIVATE_KEY, "Public Key loaded?", !!process.env.EMAILJS_PUBLIC_KEY); 
  
  try {
    console.log("Starting alert generation...");

    // Fetch failed grades
   const gradesRes = await fetch(`${process.env.ENROLLSYS_API}/failed-grades`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ENROLLSYS_API_KEY
      }
    });
    
    console.log("API Status:", gradesRes.status);
    
    const text = await gradesRes.text();
    console.log("API Response text length:", text.length);
    
    const gradesData = JSON.parse(text);
    const failedGrades = gradesData.data || [];
    console.log("Total failed grades fetched:", failedGrades.length);

    // Only officially enrolled students
    const enrolled = failedGrades.filter(
      (g) => g.student_status === "Officially Enrolled",
    );

    console.log(`Filtered to ${enrolled.length} officially enrolled`);

    // Get all existing alerts, regardless of status
    const { data: existingAlerts } = await supabase
      .from("alerts")
      .select("student_number, subject_code");
    
    const existingMap = new Set(
      (existingAlerts || []).map(
        (a) => `${a.student_number?.trim()}-${a.subject_code?.trim()}`
      )
    );
    
    // Prepare new alerts
    const newAlerts = enrolled
      .filter(g => !existingMap.has(`${g.student_number?.trim()}-${g.subject_code?.trim()}`))
      .map(g => ({
        policy_id: g.grade === "INC"
          ? "742dbfb8-5adb-4f1d-9a7a-4395baac6a58"
          : "43a56a5c-700e-43b7-ab63-146c402e26fb",
        student_id: g.student_id,
        student_number: g.student_number,
        student_name: g.student_name,
        student_email: g.student_email,
        curriculum: g.curriculum,
        subject_code: g.subject_code,
        risk: g.grade === "INC" ? "Moderate" : "High",
        status: "Active",
        reason: "Failed grade",
        description: `Student received ${g.grade} in ${g.subject_name}`,
        remarks: "Auto generated from failed grades",
      }));

    if (!newAlerts.length) {
      console.log("No new alerts to insert");
      return;
    }

    console.log(`New alerts to insert: ${newAlerts.length}`);

    // Insert into Supabase and return inserted rows
    const { data: insertedAlerts, error } = await supabase
      .from("alerts")
      .insert(newAlerts)
      .select();

    if (error) throw error;

    console.log(`Inserted ${insertedAlerts.length} new alert(s)`);
    
    // Send emails for each newly inserted alert with interval
     const EMAIL_INTERVAL = 5000; // 5 seconds between emails
     for (const alert of insertedAlerts) {
       await sendAlertEmail(alert);
       await sleep(EMAIL_INTERVAL);
     }
  } catch (err) {
    console.error("Alert generation failed:", err);
  }
}

generateAlerts(); // run once (good for GitHub Actions)

setInterval(generateAlerts, POLL_INTERVAL);
