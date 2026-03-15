// index.js
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function generateAlerts() {
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
    
    console.log("Status:", gradesRes.status);
    
    const text = await gradesRes.text();
    console.log("Response:", text);
    
    const gradesData = JSON.parse(text);

    // Only officially enrolled students
    const enrolled = failedGrades.filter(
      (g) => g.student_status === "Officially Enrolled",
    );

    console.log(`Filtered to ${enrolled.length} officially enrolled`);

    // Get existing active alerts
    const { data: existingAlerts } = await supabase
      .from("alerts")
      .select("student_number, subject_code")
      .eq("status", "Active");

    const existingMap = new Set(
      (existingAlerts || []).map(
        (a) => `${a.student_number}-${a.subject_code}`,
      ),
    );

    const newAlerts = enrolled
      .filter((g) => !existingMap.has(`${g.student_number}-${g.subject_code}`))
      .map((g) => ({
        policy_id:
          g.grade === "INC"
            ? "742dbfb8-5adb-4f1d-9a7a-4395baac6a58"
            : "43a56a5c-700e-43b7-ab63-146c402e26fb",
        student_id: g.student_id,
        student_number: g.student_number,
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

    // Insert batch
    const { error } = await supabase.from("alerts").insert(newAlerts);
    if (error) throw error;

    console.log(`Inserted ${newAlerts.length} new alert(s)`);
  } catch (err) {
    console.error("Alert generation failed:", err);
  }
}

generateAlerts(); // run once (good for GitHub Actions)
