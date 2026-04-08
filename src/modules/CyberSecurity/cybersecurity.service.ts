import { NextFunction, Request, Response } from "express";
import { FileRepository } from "../../DB/repositories/file.repository";
import fileModel from "../../DB/models/File.model";
import axios from "axios";
import { AppError } from "../../utils/ClassError";
import fs from "fs";
import FormData from "form-data";

class CyberSecurityService {
  private _fileModel = new FileRepository(fileModel);
  private scanUrl: string;

  constructor() {
    this.scanUrl =
      process.env.CYBER_SCAN_URL || "http://192.168.1.22:5000/scan";
  }

  scan = async (req: Request, res: Response, next: NextFunction) => {
    try {
    const { fileId } = req.params;

    if (!fileId || Array.isArray(fileId)) {
      throw new AppError("Invalid fileId", 400);
    }

    const file = await this._fileModel.findById(fileId);
    if (!file) throw new AppError("File not found", 404);

    if (file.userId.toString() !== req.user?.id) {
      throw new AppError(
        "You are not authorized to scan this file",
        403,
      );
    }

    if (!fs.existsSync(file.path))
      throw new AppError("File not found on server", 404);

    const formData = new FormData();
    formData.append("file", fs.createReadStream(file.path));

    const response = await axios.post(this.scanUrl, formData, {
      headers: {
        ...formData.getHeaders(),
      },
      timeout: 600000,
    });

    const data = response.data;
    // const data = {
    //   clean_text: "",
    //   file_path: "C:\\Users\\ATTIA\\AppData\\Local\\Temp\\tmpfk48urtq.pdf",
    //   file_type: "PDF",
    //   output_filter_removals: [],
    //   processed_at: "2026-03-18T20:40:00.283860+00:00",
    //   rejection_reason: "",
    //   security_score: {
    //     adversarial_input: "None",
    //     content_moderation: "Passed",
    //     malware_risk: "Medium",
    //     penalties: {
    //       medium_risk_pdf: 8,
    //       open_or_launch: 15,
    //     },
    //     prompt_injection_risk: "Low",
    //     score: 77,
    //     sensitive_data: "None",
    //     threat_indicators: "None",
    //   },
    //   status: "PROCESSING_COMPLETE",
    //   step1_ok: true,
    //   step1_reason: "File type validation passed.",
    //   step2_gate_report: {
    //     created_at: "2026-03-18T20:40:00.368414Z",
    //     debug: false,
    //     embedded_files: 0,
    //     embedded_files_details: [],
    //     encrypted: false,
    //     engine_version: "pdf-cyber-scanner-v3-improved",
    //     errors: [],
    //     explanation: "Auto-open actions (/OpenAction or /Launch) present.",
    //     extracted_urls: [],
    //     file_hash:
    //       "5fee8438bdd4ac44ae1f3601555e815c1db0648eedfcae4796309bc42d10e47c",
    //     file_id: null,
    //     file_name: "C:\\Users\\ATTIA\\AppData\\Local\\Temp\\tmpfk48urtq.pdf",
    //     flags: {
    //       has_embedded_files: false,
    //       has_external_links: false,
    //       has_forms: false,
    //       has_javascript: false,
    //       has_objstm: false,
    //       is_single_page: true,
    //     },
    //     javascript_found: false,
    //     metadata: {},
    //     num_pages: 1,
    //     objstm_count: 0,
    //     profile: "benign_like",
    //     risk_label: "Medium",
    //     risk_level: 2,
    //     security_block: false,
    //     security_decision: "review",
    //     suspicious_objects: 2,
    //     total_triggers: 2,
    //     trigger_stats: {
    //       "/OpenAction": 1,
    //       SinglePageDocument: 1,
    //     },
    //     triggers: [
    //       {
    //         page: 0,
    //         type: "SinglePageDocument",
    //       },
    //       {
    //         object: "Root",
    //         type: "/OpenAction",
    //       },
    //     ],
    //   },
    //   step2_ok: true,
    //   step2_reason: "",
    //   step3_error: "PDF text extraction failed: No module named 'fitz'",
    //   step3_text: "",
    //   step4_actions: [],
    //   step5_injection_detected: false,
    //   step5_matches: [],
    //   step6_dlp_findings: {},
    //   step6_total_redacted: 0,
    //   step7_indicators: [],
    //   step7_threat_alert: false,
    //   step7_urls_found: [],
    //   step8_content_blocked: false,
    //   step8_reason: "",
    //   step9_adversarial_detected: false,
    //   step9_techniques: [],
    //   summary:
    //     "Document contained insufficient readable text for summarization.",
    //   summary_confidence: 30,
    // };
    const updatedFile = await this._fileModel.findOneAndUpdate(
      { _id: fileId },
      {
        $set: {
          security: {
            riskScore: data.security_score.score,
            riskLevel: data.step2_gate_report.risk_level,
            riskLabel: data.step2_gate_report.risk_label,
            malwareRisk: data.security_score?.malware_risk || "Unknown",
            promptInjectionRisk:
              data.security_score?.prompt_injection_risk || "Unknown",
            contentModeration:
              data.security_score?.content_moderation || "Unknown",
          },
          scanTextSummary: data.summary || "",
          scanStatus: "completed",
        },
      },
      { new: true },
    );
    let safe = updatedFile?.security?.riskLevel !== 3

    return res.json({
      message: "Scan completed successfully",
      fileIsSafe: safe,
      updatedFile,
    });
  } catch (error: any) {
      console.error(error);

      if (axios.isAxiosError(error)) {
        return next(new AppError(error.message, 503));
      }

      next(error);
    }
  };
}

export default new CyberSecurityService();
