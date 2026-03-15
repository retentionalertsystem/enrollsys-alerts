import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Polling interval
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || "30000"); // 30s default

async function generateAlerts() {
  try {
    console.log("=======================================");
    console.log("Alert generation started at:", new Date().toISOString());

    // 1️⃣ Fetch failed grades from EnrollSys
    const gradesRes = await fetch(`${process.env.ENROLLSYS_API}/failed-grades`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ENROLLSYS_API_KEY,
      },
    });

    console.log("API Status:", gradesRes.status);

    const text = await gradesRes.text();
    console.log("API Response text length:", text.length);

    const gradesData = JSON.parse(text);
    const failedGrades = gradesData.data || [];

    console.log("Total failed grades fetched:", failedGrades.length);

    if (failedGrades.length === 0) {
      console.log("No failed grades to process. Exiting.");
      return;
    }

    // 2️⃣ Filter ONLY officially enrolled students
    const enrolledFailedGrades = failedGrades.filter(
      (g) => g.student_status === "Officially Enrolled"
    );
    console.log("Officially enrolled failed grades:", enrolledFailedGrades.length);

    // 3️⃣ Get existing active alerts
    const { data: existingAlerts, error: existingError } = await supabase
      .from("alerts")
      .select("student_number, subject_code")
      .eq("status", "Active");

    if (existingError) throw existingError;

    const existingMap = new Set(
      (existingAlerts || []).map((a) => `${a.student_number}-${a.subject_code}`)
    );

    // 4️⃣ Insert alerts safely
    let createdCount = 0;

    for (const grade of enrolledFailedGrades) {
      const key = `${grade.student_number}-${grade.subject_code}`;

      if (existingMap.has(key)) {
        console.log("Alert already exists for:", key);
        continue;
      }

      const isINC = grade.grade === "INC";
      const policyId = isINC
        ? "742dbfb8-5adb-4f1d-9a7a-4395baac6a58"
        : "43a56a5c-700e-43b7-ab63-146c402e26fb";

      const { error: insertError } = await supabase.from("alerts").insert({
        policy_id: policyId,
        student_id: grade.student_id,
        student_number: grade.student_number,
        subject_code: grade.subject_code,
        risk: isINC ? "Moderate" : "High",
        status: "Active",
        reason: "Failed grade",
        description: `Student received ${grade.grade} in ${grade.subject_name}`,
        remarks: "Auto generated from failed grades",
      });

      if (insertError) {
        console.error("Insert failed for", key, insertError);
        continue;
      }

      console.log("Inserted alert for:", key);
      createdCount++;
    }

    console.log(`Alert generation finished. ${createdCount} alert(s) created.`);
    console.log("=======================================");

  } catch (error) {
    console.error("Alert generation failed:", error);
  }
}

// Initial run
generateAlerts();

// Polling every interval
setInterval(generateAlerts, POLL_INTERVAL);
