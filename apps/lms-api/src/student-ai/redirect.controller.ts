import { All, Controller, Req, Res } from "@nestjs/common";
import { Request, Response } from "express";

@Controller("tutor")
export class TutorRedirectController {
  @All("*")
  redirect(@Req() req: Request, @Res() res: Response) {
    res.redirect(301, `/student-ai/tutor${req.path}`);
  }
}

@Controller("wrong-answers")
export class WrongAnswersRedirectController {
  @All("*")
  redirect(@Req() req: Request, @Res() res: Response) {
    res.redirect(301, `/student-ai/wrong-answers${req.path}`);
  }
}

@Controller("mastery")
export class MasteryRedirectController {
  @All("*")
  redirect(@Req() req: Request, @Res() res: Response) {
    res.redirect(301, `/student-ai/mastery${req.path}`);
  }
}

@Controller("reviews")
export class ReviewsRedirectController {
  @All("*")
  redirect(@Req() req: Request, @Res() res: Response) {
    res.redirect(301, `/student-ai/reviews${req.path}`);
  }
}

@Controller("remediation")
export class RemediationRedirectController {
  @All("*")
  redirect(@Req() req: Request, @Res() res: Response) {
    res.redirect(301, `/student-ai/recommendations${req.path}`);
  }
}
