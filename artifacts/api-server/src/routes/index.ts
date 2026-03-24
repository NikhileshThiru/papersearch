import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import searchRouter from "./search.js";
import papersRouter from "./papers.js";
import statsRouter from "./stats.js";
import adminRouter from "./admin.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(searchRouter);
router.use(papersRouter);
router.use(statsRouter);
router.use(adminRouter);

export default router;
