import React from "react";
import { Info as InfoIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { VisuallyHidden } from "./ui/visually-hidden";
import { About } from "./About";

interface InfoProps {
    isCollapsed: boolean;
}

const Info = React.forwardRef<HTMLButtonElement, InfoProps>(({ isCollapsed }, ref) => {
  return (
    <Dialog aria-describedby={undefined}>
      <DialogTrigger asChild>
        <button
          ref={ref}
          type="button"
          aria-label="About Meeting Workspace"
          className="ap-nav-item cursor-pointer border-none"
          title="About Meeting Workspace"
        >
          <InfoIcon className="h-5 w-5 shrink-0 text-gray-600" />
          {!isCollapsed && (
            <span className="ml-2 text-sm text-gray-700">About</span>
          )}
        </button>
      </DialogTrigger>
      <DialogContent>
        <VisuallyHidden>
          <DialogTitle>About Meeting Workspace</DialogTitle>
        </VisuallyHidden>
        <About />
      </DialogContent>
    </Dialog>
  );
});

Info.displayName = "About";

export default Info;
