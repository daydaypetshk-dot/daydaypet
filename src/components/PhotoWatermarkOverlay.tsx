import React from 'react';

export const PhotoWatermarkOverlay: React.FC = () => {
  return (
    // 使用 top-1/2 和 -translate-y-1/2 確保完美垂直居中在右側
    <div className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none z-50 select-none">
      <div className="bg-white/95 dark:bg-slate-900/95 border-y border-l border-slate-200/80 dark:border-slate-700/80 py-1.5 px-2.5 flex items-center justify-center shadow-[0_2px_8px_rgba(0,0,0,0.15)] rounded-l-md">
        <span className="text-[11px] sm:text-[12px] font-black tracking-[0.15em] pl-[0.15em] text-slate-800 dark:text-slate-100 whitespace-nowrap flex items-center">
          <span className="tracking-normal mr-1 text-xs">🐾</span>
          日日寵 尋寵地圖
        </span>
      </div>
    </div>
  );
};

export default PhotoWatermarkOverlay;
