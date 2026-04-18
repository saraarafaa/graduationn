import { NextFunction, Request, Response } from "express";
import { FileRepository } from "../../DB/repositories/file.repository";
import fileModel from "../../DB/models/File.model";
import fs from "fs";
import { AppError } from "../../utils/ClassError";
import axios from "axios";
import http from "http";
import https from "https";
import { summarizeSchema } from "./ai.validation";
import { ChatRepository } from "../../DB/repositories/chat.repository";
import chatModel, { Source } from "../../DB/models/chat.model";
import mongoose from "mongoose";
import path from "path";

function deduplicateSources(sources: Source[]): Source[] {
  const map = new Map<string, Source>();

  for (const item of sources) {
    const key = `${item.source}-${item.page}`;

    if (!map.has(key)) {
      map.set(key, item);
    }
  }

  return Array.from(map.values());
}

class AiService {
  constructor() {
    this.aiBaseUrl = process.env.AI_SERVICE_URL || "http://localhost:8000";
  }
  private _fileModel = new FileRepository(fileModel);
  private _chatModel = new ChatRepository(chatModel);
  private aiBaseUrl: string;

  private transformSuggestions(aiData: any) {
    if (!aiData?.suggestions) return [];

    return aiData.suggestions.map((s: any) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      chartType: s.type,

      mapping: {
        ...(s.x_col && {
          x: {
            column: s.x_col,
            type: this.inferType(s.x_col),
          },
        }),

        ...(s.y_col && {
          y: {
            column: s.y_col,
            type: this.inferType(s.y_col),
          },
        }),

        ...(s.color_col && {
          color: {
            column: s.color_col,
            type: this.inferType(s.color_col),
          },
        }),
      },

      options: {
        aggregation: s.agg,
      },
    }));
  }

  private inferType(column: string): "number" | "string" | "date" {
    const col = column.toLowerCase();

    if (col.includes("date") || col.includes("time")) return "date";

    if (
      col.includes("price") ||
      col.includes("amount") ||
      col.includes("revenue") ||
      col.includes("count")
    )
      return "number";

    return "string";
  }

  summarize = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { fileId } = summarizeSchema.params.parse(req.params);

      if (!fileId || Array.isArray(fileId)) {
        throw new AppError("Invalid fileId", 400);
      }

      const file = await this._fileModel.findById(fileId);

      if (!file) {
        throw new AppError("File not found", 404);
      }

      if (file.userId.toString() !== req.user?.id) {
        throw new AppError(
          "You are not authorized to summarize this file",
          403,
        );
      }

      const filePath = path.resolve(file.path);

      if (!filePath || !fs.existsSync(filePath)) {
        throw new AppError("File not found on disk", 404);
      }

      if (file.summary) {
        return res.json({
          message: "Already summarized",
          summary: file.summary,
        });
      }

      const response = await axios.post(
        `${this.aiBaseUrl}/api/summarize`,
        { filePath },
        {
          timeout: 600000,
          httpAgent: new http.Agent({ keepAlive: true }),
          httpsAgent: new https.Agent({ keepAlive: true }),
        },
      );

      const summary = response.data.summary;
      // const summary = "Baheb sara awiii agmal wahda fel team amora w gamela bgad yaayyyyy";

      const updatedFile = await this._fileModel.findOneAndUpdate(
        { _id: fileId },
        { summary },
        { new: true },
      );

      return res.json({
        message: "Summary retrieved successfully",
        summary: updatedFile?.summary,
        fileUrl: `${req.protocol}://${req.get("host")}/${file.path}`,
      });
    } catch (error) {
      next(error);
    }
  };

  askQuestion = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { fileId } = req.params;
      const { question } = req.body;

      if (!fileId || Array.isArray(fileId)) {
        throw new AppError("Invalid fileId", 400);
      }

      const file = await this._fileModel.findById(fileId);
      if (!file) throw new AppError("File not found", 404);

      if (file.userId.toString() !== req.user?.id) {
        throw new AppError(
          "You are not authorized to ask questions on this file",
          403,
        );
      }

      const filePath = path.resolve(file.path);

      const response = await axios.post(
        `${this.aiBaseUrl}/api/ask`,
        {
          filePath,
          question,
        },
        {
          timeout: 600000,
          httpAgent: new http.Agent({ keepAlive: true }),
          httpsAgent: new https.Agent({ keepAlive: true }),
        },
      );

      // const answer: string = `lololollolo`;
      // let sources = [
      //   { source: "Networking Fundamentals lesson -5-.pdf", page: 1 },
      //   { source: "Networking Fundamentals lesson -5-.pdf", page: 3 },
      //   { source: "Networking Fundamentals lesson -5-.pdf", page: 4 },
      //   { source: "Networking Fundamentals lesson -5-.pdf", page: 4 },
      // ];
      const answer: string = response.data.answer;
      let sources: Source[] = response.data.sources;

      sources = deduplicateSources(sources);

      await this._chatModel.create({
        fileId: new mongoose.Types.ObjectId(fileId),
        question,
        answer,
        sources,
      });

      return res.json({
        message: "Answer retrieved successfully",
        answer,
        sources,
      });
    } catch (error: any) {
      if (error instanceof Error && "errors" in error) {
        return res.status(400).json({ message: (error as any).errors });
      }
      next(error);
    }
  };

  getChatHistory = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { fileId } = req.params;

      if (!fileId || Array.isArray(fileId)) {
        throw new AppError("Invalid fileId", 400);
      }
      const file = await this._fileModel.findById(fileId);

      if (!file) throw new AppError("File not found", 404);

      if (file.userId.toString() !== req.user?.id) {
        throw new AppError("You are not authorized to view this chat", 403);
      }

      const chats = await this._chatModel.find({
        filter: { fileId: new mongoose.Types.ObjectId(fileId) },
        options: { sort: { createdAt: 1 } },
      });

      return res.json({
        message: "Chat history retrieved successfully",
        chats,
      });
    } catch (error: any) {
      if (error instanceof Error && "errors" in error) {
        return res.status(400).json({ message: (error as any).errors });
      }
      next(error);
    }
  };

  chartOptions = async (req: Request, res: Response, next: NextFunction) => {
    const { fileId } = req.params;
    const userId = req?.user?._id;

    if (!userId) throw new AppError("InValid UserId", 404);

    if (!fileId) throw new AppError("InValid fileId", 404);

    const file = await this._fileModel.findOne({ _id: fileId });
    if (!file) throw new AppError("File not found", 404);

    if (file.userId.toString() !== req.user?.id) {
      throw new AppError("You are not authorized", 403);
    }

    if (file.fileType !== "csv") {
      throw new AppError("Chart generation only supported for CSV", 400);
    }

    const filePath = path.resolve(file.path);

    if (!filePath || !fs.existsSync(filePath)) {
      throw new AppError("File not found on disk", 404);
    }

    const response = await axios.post(
      `${this.aiBaseUrl}/api/chart`,
      { filePath },
      {
        timeout: 600000,
        httpAgent: new http.Agent({ keepAlive: true }),
        httpsAgent: new https.Agent({ keepAlive: true }),
      },
    );

    const transformedCharts = this.transformSuggestions(response.data);
    // const transformedCharts = this.transformSuggestions({
    //   suggestions: [
    //     {
    //       id: "chart_1",
    //       title: "Revenue by Category",
    //       description: "Bar chart of revenue",
    //       type: "bar",
    //       x_col: "category",
    //       y_col: "revenue",
    //       color_col: null,
    //       agg: "sum",
    //     },
    //     {
    //       id: "chart_2",
    //       title: "Revenue by Category",
    //       description: "Bar chart of lolll",
    //       type: "bar",
    //       x_col: "srrrr",
    //       y_col: "vrrrr",
    //       color_col: null,
    //       agg: "dupl",
    //     },
    //   ],
    // });

    file.charts = transformedCharts;
    await file.save();

    return res.status(200).json({
      message: "Charts generated successfully",
      charts: transformedCharts,
    });
  };

  visualizeCharts = async (req: Request, res: Response, next: NextFunction) => {
    const { fileId } = req.params;
    const { selectedCharts } = req.body;

    if (!fileId) throw new AppError("Invalid fileId", 400);
    if (!selectedCharts || !Array.isArray(selectedCharts)) {
      throw new AppError("selectedCharts must be an array", 400);
    }

    const file = await this._fileModel.findOne({ _id: fileId });
    if (!file) throw new AppError("File not found", 404);

    if (file.userId.toString() !== req.user?.id) {
      throw new AppError("Unauthorized", 403);
    }

    if (file.fileType !== "csv") {
      throw new AppError("Only CSV supported", 400);
    }

    const chartsToSend = file?.charts?.filter((chart) =>
      selectedCharts.includes(chart.id),
    );

    if (!chartsToSend) throw new AppError("No charts selected", 400);

    if (chartsToSend.length === 0) {
      throw new AppError("No valid charts selected", 400);
    }

    const filePath = path.resolve(file.path);

    const response = await axios.post(
      `${this.aiBaseUrl}/api/visualize`,
      {
        filePath,
        charts: chartsToSend,
      },
      {
        timeout: 600000,
        httpAgent: new http.Agent({ keepAlive: true }),
        httpsAgent: new https.Agent({ keepAlive: true }),
      },
    );

    const chartsImages = response.data.results;
    // const chartsImages = [
    //   {
    //     chartId: "chart_1",
    //     imageUrl: "https://your-domain.com/uploads/charts/chart_1.png",
    //   },
    //   {
    //     chartId: "chart_2",
    //     imageUrl: "https://your-domain.com/uploads/charts/chart_2.png",
    //   },
    // ];
    const imageMap = new Map(
      chartsImages.map((item: any) => [item.chartId, item.imageUrl]),
    );

    file.charts = file.charts!.map((chart: any) => {
      if (imageMap.has(chart.id)) {
        return {
          ...chart,
          imageUrl: imageMap.get(chart.id),
        };
      }
      return chart;
    });

    await file.save();

    return res.status(200).json({
      message: "Charts generated successfully",
      charts: file.charts,
    });
  };
}

export default new AiService();
