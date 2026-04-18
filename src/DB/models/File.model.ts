import mongoose, { Schema, model, Types } from "mongoose";
import { chartSchema } from "./chart.schema";

export interface IFile {
  userId: Types.ObjectId;
  categoryId: Types.ObjectId;
  fileName: string;
  path: string;
  fileType: "pdf" | "csv" | "image";

  security?: {
    riskScore: number;
    riskLevel: number;
    riskLabel: string;
    malwareRisk: string;
    promptInjectionRisk: string;
    contentModeration: string;
    scanStatus: string;
    triggerStatus: Record<string, number>;
  };

  scanTextSummary?: string;
  summary?: string;

  charts?: {
    id: string;
    title: string;
    description?: string;
    imageUrl?: string;
    chartType: string;
    mapping?: {
      x?: { column: string; type: "number" | "string" | "date" };
      y?: { column: string; type: "number" | "string" | "date" };
      value?: { column: string; type: "number" | "string" | "date" };
      category?: { column: string; type: "number" | "string" | "date" };
      color?: { column: string; type: "number" | "string" | "date" };
    };
    options?: {
      aggregation?: string;
    };
  }[];

  createdAt: Date;
  updatedAt: Date;
}

const fileSchema = new Schema<IFile>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },

    fileName: {
      type: String,
      required: true,
    },

    path: {
      type: String,
      required: true,
    },
    fileType: {
      type: String,
      enum: ["pdf", "csv", "image"],
      required: true,
    },

    security: {
      riskScore: Number,
      riskLevel: Number,
      riskLabel: String,
      malwareRisk: String,
      promptInjectionRisk: String,
      contentModeration: String,
      scanStatus: String,

      triggerStatus: {
        type: Map,
        of: Number,
        default: {},
      },
    },

    scanTextSummary: String,
    summary: String,
    charts: {
      type: [chartSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

const fileModel =
  mongoose.models.File || mongoose.model<IFile>("File", fileSchema);

export default fileModel;
