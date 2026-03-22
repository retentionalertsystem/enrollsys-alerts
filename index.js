import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || "60000");

function buildWarningDetails(studentAlerts) {
  const incSubjects = studentAlerts.filter(
    (row) => String(row.grade || "").trim().toUpperCase() === "INC"
  );

  const failedSubjects = studentAlerts.filter(
    (row) => String(row.grade || "").trim() === "5.0"
  );

  const incCount = incSubjects.length;
  const fiveCount = failedSubjects.length;

  const incList = incSubjects
    .map((row) => row.subject_code)
    .filter(Boolean)
    .join(", ");

  const failedList = failedSubjects
    .map((row) => row.subject_code)
    .filter(Boolean)
    .join(", ");

  let warningLevel = "No Warning";
  let warningTitle = "Good Academic Standing";
  let warningMessage =
    "Based on the current academic records in the system, you do not meet the conditions for any retention warning at this time.";

  if (fiveCount >= 3) {
    warningLevel = "Elimination";
    warningTitle = "Recommended for Elimination";
    warningMessage = `Our records show that you have incurred failing grades in ${fiveCount} subjects (${failedList || "subjects not specified"}), which already meets the condition for elimination under the academic retention policy. This indicates a critical academic standing and suggests that you are no longer meeting the minimum retention standard of the program. You are strongly advised to coordinate immediately with your program adviser or department for formal evaluation and guidance regarding your academic status.`;
  } else if (fiveCount >= 2) {
    warningLevel = "Final Warning";
    warningTitle = "Final Academic Warning";
    warningMessage = `Our records show that you have incurred failing grades in ${fiveCount} subjects (${failedList || "subjects not specified"}), which places you under Final Warning status. This is considered a serious academic concern and indicates that any additional failing grade may lead to elimination from the program. Immediate academic intervention, close monitoring, and compliance with the prescribed action plan are strongly advised.`;
  } else if (fiveCount >= 1) {
    warningLevel = "Second Warning";
    warningTitle = "Second Academic Warning";
    warningMessage = `Our records show that you have incurred a failing grade in ${fiveCount} subject (${failedList || "subject not specified"}), which places you under Second Warning status. This reflects a serious academic deficiency and indicates that your academic performance requires immediate improvement. You are advised to take corrective action at once, since additional failing grades may escalate your status to Final Warning or Elimination.`;
  } else if (incCount >= 1) {
    warningLevel = "First Warning";
    warningTitle = "First Academic Warning";
    warningMessage = `Our records show that you have an INC in ${incCount} subject${incCount > 1 ? "s" : ""} (${incList || "subjects not specified"}), which places you under First Warning status. This means that some academic requirements remain incomplete. You are advised to settle all deficiencies as soon as possible to avoid further penalties and possible escalation of your retention status.`;
  }

  return {
    warningLevel,
    warningTitle,
    warningMessage,
    incCount,
    fiveCount,
  };
}

async function sendAlertEmail(alert) {
  try {
    const { data: studentAlerts, error } = await supabase
      .from("alerts")
      .select("grade, subject_code, status")
      .eq("student_id", alert.student_id);
      // optional:
      // .neq("status", "Resolved");

    if (error) throw error;

    const { warningLevel, warningTitle, warningMessage } =
      buildWarningDetails(studentAlerts || []);

    const templateParams = {
      student_name: alert.student_name || "Student",
      student_email: alert.student_email,
      message: `This is to inform you that a retention alert has been created.

Alert Details:

Subject Code: ${alert.subject_code}
Risk Level: ${alert.risk || "N/A"}
Reason: ${alert.reason || "N/A"}
Description: ${alert.description || "N/A"}
Created At: ${alert.created_at ? new Date(alert.created_at).toLocaleString() : "N/A"}

Academic Warning Assessment:

${warningTitle}
Retention Status: ${warningLevel}

${warningMessage}

Please coordinate with your adviser or the appropriate academic office for guidance and necessary intervention under the retention policy.`
    };

    const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
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
      console.log(
        `Email sent successfully to ${alert.student_email} [${warningLevel}]`,
        text
      );
    } else {
      console.error("Email failed:", text);
    }
  } catch (err) {
    console.error("Email sending failed:", err);
  }
}

async function generateAlerts() {
  console.log("API URL:", process.env.ENROLLSYS_API);
  console.log("API Key:", process.env.ENROLLSYS_API_KEY?.slice(0, 5) + "...");
  console.log(
    "Private Key loaded?",
    !!process.env.EMAILJS_PRIVATE_KEY,
    "Public Key loaded?",
    !!process.env.EMAILJS_PUBLIC_KEY
  );

  try {
    console.log("Starting alert generation...");

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

    const enrolled = failedGrades.filter(
      (g) => g.student_status === "Officially Enrolled",
    );

    console.log(`Filtered to ${enrolled.length} officially enrolled`);

    const { data: existingAlerts } = await supabase
      .from("alerts")
      .select("student_number, subject_code");

    const existingMap = new Set(
      (existingAlerts || []).map(
        (a) => `${a.student_number?.trim()}-${a.subject_code?.trim()}`
      )
    );

    const newAlerts = enrolled
      .filter(
        (g) =>
          !existingMap.has(
            `${g.student_number?.trim()}-${g.subject_code?.trim()}`
          )
      )
      .map((g) => ({
        policy_id:
          g.grade === "INC"
            ? "742dbfb8-5adb-4f1d-9a7a-4395baac6a58"
            : "43a56a5c-700e-43b7-ab63-146c402e26fb",
        student_id: g.student_id,
        student_number: g.student_number,
        student_name: g.student_name,
        student_email: g.student_email,
        curriculum: g.curriculum,
        grade: g.grade,
        subject_code: g.subject_code,
        risk: g.grade === "INC" ? "Moderate" : "High",
        status: "Active",
        reason: g.grade === "INC" ? "Incomplete grade" : "Failed grade",
        description: `Student received ${g.grade} in ${g.subject_name}`,
        remarks: "Auto generated from failed grades",
      }));

    if (!newAlerts.length) {
      console.log("No new alerts to insert");
      return;
    }

    console.log(`New alerts to insert: ${newAlerts.length}`);

    const { data: insertedAlerts, error } = await supabase
      .from("alerts")
      .insert(newAlerts)
      .select();

    if (error) throw error;

    console.log(`Inserted ${insertedAlerts.length} new alert(s)`);

    const EMAIL_INTERVAL = 5000;
    for (const alert of insertedAlerts) {
      await sendAlertEmail(alert);
      await sleep(EMAIL_INTERVAL);
    }
  } catch (err) {
    console.error("Alert generation failed:", err);
  }
}

generateAlerts();
setInterval(generateAlerts, POLL_INTERVAL);
