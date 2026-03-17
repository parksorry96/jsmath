declare module "react-native-math-view" {
  import { ComponentType } from "react";
  import { ViewStyle, StyleProp } from "react-native";

  interface MathViewProps {
    math: string;
    style?: StyleProp<ViewStyle>;
    color?: string;
    resizeMode?: "contain" | "cover";
    config?: {
      inline?: boolean;
      displayAlign?: "auto" | "center" | "left" | "right";
    };
    debug?: boolean;
    renderError?: ComponentType;
  }

  const MathView: ComponentType<MathViewProps>;
  export default MathView;

  export interface MathTextProps {
    value?: string;
    math?: string;
    style?: StyleProp<ViewStyle>;
    direction?: "ltr" | "rtl" | "auto";
    Component?: ComponentType;
  }

  export const MathText: ComponentType<MathTextProps>;
}
