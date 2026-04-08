import { NextFunction, Request, Response } from "express";
import { AppError } from "../../utils/ClassError";
import { FileRepository } from "../../DB/repositories/file.repository";
import fileModel from "../../DB/models/File.model";
import fs from "fs/promises";
import { CategoryRepository } from "../../DB/repositories/category.repository";
import categoryModel from "../../DB/models/category.model";

class UploadService {
  private _fileModel = new FileRepository(fileModel);
  private _categoryModel = new CategoryRepository(categoryModel);

  upload = async (req: Request, res: Response, next: NextFunction) => {
    const file = (req as any).file as Express.Multer.File | undefined;
    const userId = req?.user?._id;

    if (!file || !file.path || !userId)
      throw new AppError("Upload failed, Missing the file or UserId", 404);

    const generalCategory = await this._categoryModel.findOne({
      userId,
      categoryName: "General Category",
    });

    if (!generalCategory) throw new AppError("Category Not Found", 404);

    const pdf = await this._fileModel.create({
      userId,
      categoryId: generalCategory?._id!,
      fileName: req?.file?.filename!,
      path: req?.file?.path!,
    });

    return res.status(200).json({ message: "File uploaded successfully", pdf });
  };

  recentFiles = async (req: Request, res: Response, next: NextFunction) => {
    const userId = req?.user?._id;

    if (!userId) {
      throw new AppError("User Not Found", 404);
    }

    const files = await this._fileModel.find({ filter: { userId } });

    const filesWithUrls = files.map((file) => {
      return {
        url: `${req.protocol}://${req.get("host")}/${file.path}`,
      };
    });

    if (filesWithUrls.length == 0)
      return res.status(200).json({ message: "No Files Uploaded Yet" });

    return res.status(200).json({
      message: "success",
      files: filesWithUrls,
    });
  };

  deleteFile = async (req: Request, res: Response, next: NextFunction) => {
    const { fileId } = req.params;

    const file = await this._fileModel.findOne({ _id: fileId });

    if (!file) throw new AppError("File not found", 404);

    if (req?.user?._id.toString() !== file.userId.toString())
      throw new AppError("You are not authorized", 401);

    await fs.unlink(file.path);
    await this._fileModel.findOneAndDelete({ _id: fileId });

    return res.status(200).json({ message: "File deleted" });
  };

  searchFiles = async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?._id;
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";

    if (!userId) {
      throw new AppError("User not found", 404);
    }

    const files = await this._fileModel.find({
      filter: { userId, fileName: { $regex: search, $options: "i" } },
    });

    if (files.length === 0) {
      return res.status(200).json({ message: "No matched file", files: [] });
    }

    const filesWithUrls = files.map((file) => ({
      ...file.toObject(),
      url: `${req.protocol}://${req.get("host")}/${file.path}`,
    }));

    return res.status(200).json({
      message: "success",
      files: filesWithUrls,
    });
  };

  addToCategory = async (req: Request, res: Response, next: NextFunction) => {
    const { useGeneral, newCategoryName, categoryId } = req.body;
    const { fileId } = req.params;
    const userId = req.user?._id;

    if (!fileId) throw new AppError("File Not Found", 404);
    if (!userId) throw new AppError("User Not Found", 404);

    const file = await this._fileModel.findOne({ _id: fileId, userId });
    if (!file) throw new AppError("File not found or unauthorized", 404);

    const optionsCount = [useGeneral, categoryId, newCategoryName].filter(
      Boolean,
    ).length;

    if (optionsCount !== 1) {
      throw new AppError("Choose only one option", 400);
    }

    let finalCategoryId;

    if (useGeneral) {
      const general = await this._categoryModel.findOne({
        userId,
        categoryName: "General Category",
      });

      if (!general) {
        throw new AppError("General category not found", 500);
      }

      finalCategoryId = general._id;
    } else if (categoryId) {
      const category = await this._categoryModel.findOne({
        _id: categoryId,
        userId,
      });

      if (!category) {
        throw new AppError("Invalid category", 400);
      }

      finalCategoryId = category._id;
    } else if (newCategoryName) {
      const name = newCategoryName.trim().toLowerCase();

      if (!name) {
        throw new AppError("Invalid category name", 400);
      }

      let category = await this._categoryModel.findOne({
        categoryName: name,
        userId,
      });

      if (!category) {
        category = await this._categoryModel.create({
          categoryName: name,
          userId,
        });
      }

      finalCategoryId = category._id;
    }

    await this._fileModel.findOneAndUpdate(
      { _id: fileId, userId },
      { categoryId: finalCategoryId },
      { new: true },
    );

    return res.status(200).json({ message: "Success" });
  };

  getAllCategories = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const userId = req?.user?._id;

    if (!userId) throw new AppError("User not found", 404);

    const categories = await this._categoryModel.find({ filter: { userId } });

    if (!categories)
      return res.status(200).json({ message: "No categories for this user" });

    return res.status(200).json({ message: "success", categories });
  };

  deleteCategory = async (req: Request, res: Response, next: NextFunction) => {
    const { categoryId } = req.params;
    const userId = req?.user?._id;

    if (!userId) throw new AppError("User Not Found", 404);

    const category = await this._categoryModel.findOne({
      _id: categoryId,
      userId,
    });

    if (!category)
      throw new AppError("Category Not Found Or not authorized", 401);

    if (category.categoryName == "General Category")
      throw new AppError("General Category cannot be deleted", 403);

    const general = await this._categoryModel.findOne({
      categoryName: "General Category",
      userId,
    });
    if (!general) throw new AppError("General category Not found", 404);

    await this._fileModel.updateMany(
      { categoryId: category._id },
      { categoryId: general._id },
    );
    await this._categoryModel.findOneAndDelete({ _id: categoryId });

    return res.status(200).json({ message: "Category deleted successfully" });
  };
}

export default new UploadService();
