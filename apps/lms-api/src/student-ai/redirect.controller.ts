import { All, Controller, Req, Res, UseGuards } from "@nestjs/common";
import { Request, Response } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";

@Controller("tutor")
@UseGuards(JwtAuthGuard)
export class TutorRedirectController {
  @All("*")
  redirect(@Req() req: Request, @Res() res: Response) {
    res.redirect(308, `/student-ai/tutor${req.path}`);
  }
}

@Controller("wrong-answers")
@UseGuards(JwtAuthGuard)
export class WrongAnswersRedirectController {
  @All("*")
  redirect(@Req() req: Request, @Res() res: Response) {
    res.redirect(308, `/student-ai/wrong-answers${req.path}`);
  }
}

@Controller("mastery")
@UseGuards(JwtAuthGuard)
export class MasteryRedirectController {
  @All("*")
  redirect(@Req() req: Request, @Res() res: Response) {
    res.redirect(308, `/student-ai/mastery${req.path}`);
  }
}

@Controller("reviews")
@UseGuards(JwtAuthGuard)
export class ReviewsRedirectController {
  @All("*")
  redirect(@Req() req: Request, @Res() res: Response) {
    res.redirect(308, `/student-ai/reviews${req.path}`);
  }
}

@Controller("remediation")
@UseGuards(JwtAuthGuard)
export class RemediationRedirectController {
  @All("*")
  redirect(@Req() req: Request, @Res() res: Response) {
    res.redirect(308, `/student-ai/recommendations${req.path}`);
  }
}
